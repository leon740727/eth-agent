"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const r = require("ramda");
const http = require("http");
const eth = require("eth-utils");
const ethUtils = require("ethereumjs-util");
const connector_1 = require("./connector");
const block_stream_1 = require("./m/block-stream");
const nonce_agent_1 = require("./m/nonce-agent");
const event_stream_1 = require("./m/event-stream");
const _EventId = require("./m/event-id");
const result = require("./m/result");
const sync_queue_1 = require("./m/sync-queue");
const utils_1 = require("./m/utils");
const WebSocketServer = require('websocket').server;
const WebSocketConnection = require('websocket').connection;
var Result;
(function (Result) {
    Result.of = result.of;
    Result.ofError = result.ofError;
})(Result = exports.Result || (exports.Result = {}));
function receipts(web3, block) {
    const txs = block.transactions;
    return Promise.all(txs.map(tx => web3.eth.getTransactionReceipt(tx)));
}
function logs(web3, block) {
    return __awaiter(this, void 0, void 0, function* () {
        return utils_1.flatten((yield receipts(web3, block)).map(r => r.logs));
    });
}
function events(web3, log, logTransformers) {
    function match(transformer, log) {
        function eventSig1(log) {
            return log.topics ? log.topics[0] : null;
        }
        const eventSig2 = (abi) => {
            return web3.eth.abi.encodeEventSignature(r.pick(['name', 'type', 'inputs'], abi));
        };
        return eth.fmt.hex(transformer.contract) === eth.fmt.hex(log.address) &&
            eventSig2(transformer.eventAbi) === eventSig1(log);
    }
    return logTransformers
        .filter(t => match(t, log))
        .map(t => {
        const result = eth.decodeLog(web3, log, [t.eventAbi]);
        const pieces = t.transformer(log, result.parameters);
        return pieces.map(p => ({
            id: exports.EventId.make(log.blockHash, log.logIndex),
            event: p.event,
            data: p.data,
            log: log,
        }));
    })
        .reduce((acc, lst) => acc.concat(lst), []);
}
const q = new sync_queue_1.default();
function _logsFrom(web3, block, logIndex, endBlock) {
    return __awaiter(this, void 0, void 0, function* () {
        if (endBlock() >= block) {
            const blk = yield web3.eth.getBlock(block);
            const _logs = (yield logs(web3, blk))
                .filter(log => log.logIndex > logIndex);
            return [_logs, () => _logsFrom(web3, block + 1, -1, endBlock)];
        }
        else {
            return [[], null];
        }
    });
}
exports._logsFrom = _logsFrom;
class Agent {
    constructor(makeProvider, txHasher, keys, confirmDepth) {
        this.makeProvider = makeProvider;
        this.txHasher = txHasher;
        this.conn = new connector_1.default();
        this.nonceAgentOf = {};
        this.receiptStream = new event_stream_1.default(receipt => eth.fmt.hex(receipt.transactionHash));
        this.actionOf = {};
        this.logTransformers = [];
        this.eventListenersOf = {};
        this.confirmedBlockHead = null;
        keys.forEach(key => {
            const sender = eth.fmt.hex(ethUtils.privateToAddress(key).toString('hex'));
            this.nonceAgentOf[sender] = new nonce_agent_1.NonceAgent(this.web3, key);
        });
        const bs = new block_stream_1.default(confirmDepth);
        this.conn.onNewBlock(block => bs.inject(this.web3, block.number));
        bs.onConfirmedBlock((block) => __awaiter(this, void 0, void 0, function* () {
            q.push(() => __awaiter(this, void 0, void 0, function* () {
                this.confirmedBlockHead = block;
                (yield logs(this.web3, block))
                    .map(log => events(this.web3, log, this.logTransformers))
                    .reduce((acc, lst) => acc.concat(lst), [])
                    .forEach(event => this.emit(event));
            }));
        }));
        bs.onConfirmedBlock((block) => __awaiter(this, void 0, void 0, function* () {
            (yield receipts(this.web3, block)).forEach(r => this.receiptStream.trigger(r));
        }));
    }
    get web3() {
        return this.conn.web3;
    }
    emit(event) {
        (this.eventListenersOf[event.event] || [])
            .forEach(conn => conn.sendUTF(JSON.stringify(event)));
    }
    exec(req) {
        return __awaiter(this, void 0, void 0, function* () {
            const handler = this.actionOf[req.command];
            if (handler) {
                return handler(...req.arguments)
                    .catch(error => result.ofError(error.toString()));
            }
            else {
                return result.ofError(`action '${req.command}' not found`);
            }
        });
    }
    setEventListener(req, connection) {
        return __awaiter(this, void 0, void 0, function* () {
            // 基本策略是先把舊的 event 傳出去後，再註冊 event listener
            // 但如果 req.lastEventId 是非常久以前的 event，第一階段的工作會花很久時間
            // 為了不阻塞其他 connection 的工作。把傳遞舊 event 的工作拆成很多塊
            const register = () => {
                // 清除原本註冊的資料
                this.eventListenersOf = r.mapObjIndexed((conns, event) => conns.filter(conn => conn !== connection), this.eventListenersOf);
                req.events.forEach(event => {
                    this.eventListenersOf[event] = (this.eventListenersOf[event] || []).concat([connection]);
                });
            };
            const emit = (logFetcher) => __awaiter(this, void 0, void 0, function* () {
                const [logs, next] = yield logFetcher();
                utils_1.flatten(logs.map(log => events(this.web3, log, this.logTransformers)))
                    .forEach(event => connection.sendUTF(JSON.stringify(event)));
                if (next !== null) {
                    q.push(() => emit(next));
                }
                else {
                    register();
                }
            });
            if (req.lastEventId) {
                yield utils_1.waitFor(() => this.confirmedBlockHead !== null, 1);
                const logIdx = exports.EventId.logIndex(req.lastEventId);
                this.web3.eth.getBlock(exports.EventId.block(req.lastEventId))
                    .then(block => {
                    q.push(() => emit(() => _logsFrom(this.web3, block.number, logIdx, () => this.confirmedBlockHead.number)));
                });
            }
            else {
                register();
            }
            return result.of(req.events);
        });
    }
    serve(port, subprotocol) {
        this.conn.connect(this.makeProvider);
        const server = http.createServer((_, res) => {
            // 不支援一般的 request event
            res.writeHead(404);
            res.end();
        });
        server.listen(port, function () {
            console.log(`Server is listening on port ${port}`);
        });
        let wsServer = new WebSocketServer({
            httpServer: server,
            autoAcceptConnections: false
        });
        wsServer.on('request', request => {
            function originIsAllowed(origin) {
                // put logic here to detect whether the specified origin is allowed.
                return true;
            }
            if (!originIsAllowed(request.origin)) {
                // Make sure we only accept requests from an allowed origin
                request.reject();
                console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
                return;
            }
            var connection = request.accept(subprotocol, request.origin);
            connection.on('message', (message) => __awaiter(this, void 0, void 0, function* () {
                if (message.type !== 'utf8') {
                    connection.close(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR);
                }
                else {
                    const req = JSON.parse(message.utf8Data);
                    if (req.type === 'ActionRequest') {
                        const result = yield this.exec(req);
                        connection.sendUTF(JSON.stringify(result));
                    }
                    else if (req.type === 'EventsRequest') {
                        const result = yield this.setEventListener(req, connection);
                        connection.sendUTF(JSON.stringify(result));
                    }
                    else {
                        const _ = req;
                    }
                }
            }));
        });
    }
    /** helper */
    send(sender, rawTx) {
        return __awaiter(this, void 0, void 0, function* () {
            const tx = yield this.nonceAgentOf[eth.fmt.hex(sender)].send(rawTx);
            return this.receiptStream.waitFor(eth.fmt.hex(this.txHasher(tx)));
        });
    }
    /** 將收到的 Log 轉成 Event */
    setLogTransformer(contract, eventAbi, transformer) {
        this.logTransformers.push({ contract, eventAbi, transformer });
    }
    setAction(command, handler) {
        this.actionOf[command] = handler;
    }
}
exports.Agent = Agent;
