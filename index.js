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
const result = require("./m/result");
const utils_1 = require("./m/utils");
const WebSocketServer = require('websocket').server;
const WebSocketConnection = require('websocket').connection;
var Result;
(function (Result) {
    Result.of = result.of;
    Result.ofError = result.ofError;
})(Result = exports.Result || (exports.Result = {}));
function events(web3, block, logTransformers) {
    return __awaiter(this, void 0, void 0, function* () {
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
        function events(log) {
            return utils_1.flatten(logTransformers
                .filter(t => match(t, log))
                .map(t => {
                const result = eth.decodeLog(web3, log, [t.eventAbi]);
                const pieces = t.transformer(log, result.parameters);
                return pieces.map(p => ({
                    id: log.blockHash + ',' + log.logIndex,
                    event: p.event,
                    data: p.data,
                    log: log,
                }));
            }));
        }
        const receipts = yield Promise.all(block.transactions.map(tx => web3.eth.getTransactionReceipt(tx)));
        const logs = utils_1.flatten(receipts.map(r => r.logs || []));
        return utils_1.flatten(logs.map(events));
    });
}
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
        keys.forEach(key => {
            const sender = eth.fmt.hex(ethUtils.privateToAddress(key).toString('hex'));
            this.nonceAgentOf[sender] = new nonce_agent_1.NonceAgent(this.web3, key);
        });
        const bs = new block_stream_1.default(confirmDepth);
        this.conn.onNewBlock(block => bs.inject(this.web3, block.number));
        bs.onConfirmedBlock((block) => __awaiter(this, void 0, void 0, function* () {
            (yield events(this.web3, block, this.logTransformers))
                .forEach(event => {
                (this.eventListenersOf[event.event] || [])
                    .forEach(conn => conn.sendUTF(JSON.stringify(event)));
            });
        }));
        bs.onConfirmedBlock((block) => __awaiter(this, void 0, void 0, function* () {
            const receipts = yield Promise.all(block.transactions.map(tx => this.web3.eth.getTransactionReceipt(tx)));
            receipts.forEach(r => this.receiptStream.trigger(r));
        }));
    }
    get web3() {
        return this.conn.web3;
    }
    exec(req) {
        return __awaiter(this, void 0, void 0, function* () {
            const handler = this.actionOf[req.command];
            if (handler) {
                return handler(req.arguments)
                    .catch(error => result.ofError(error.toString()));
            }
            else {
                return result.ofError(`action '${req.command}' not found`);
            }
        });
    }
    addEventListener(req, connection) {
        req.events.forEach(event => {
            this.eventListenersOf[event] = (this.eventListenersOf[event] || []).concat([connection]);
        });
        return result.of(req.events);
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
                        const result = this.addEventListener(req, connection);
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
            return this.receiptStream.waitFor(this.txHasher(tx));
        });
    }
    /** 將收到的 Log 轉成 Event 發出 */
    on(contract, eventAbi, transformer) {
        this.logTransformers.push({ contract, eventAbi, transformer });
    }
    setAction(command, handler) {
        this.actionOf[command] = handler;
    }
}
exports.Agent = Agent;
