import * as r from 'ramda';
import Web3 = require('web3');
import { Log, TransactionReceipt } from 'web3/types';
import { Block } from 'web3/eth/types';
import { ABIDefinition  } from 'web3/eth/abi';
import { Provider } from 'web3/providers';
import http = require('http');
import * as eth from 'eth-utils';
import * as ethUtils from 'ethereumjs-util';
import Connector from './connector';
import BlockStream from './m/block-stream';
import { NonceAgent, RawTx, Tx } from './m/nonce-agent';
import EventStream from './m/event-stream';
import * as _EventId from './m/event-id';
import * as result from './m/result';
import SyncQueue from './m/sync-queue';
import { EventListener, flatten, waitFor } from './m/utils';
const WebSocketServer = require('websocket').server;
const WebSocketConnection = require('websocket').connection;

export const EventId = _EventId;
export { RawTx } from './m/nonce-agent';

export namespace Result {
    export type Type <T> = result.Type <T>;
    export const of: <T> (data: T) => Type<T> = result.of;
    export const ofError: <T> (error: string) => Type<T> = result.ofError;
}

type Primitive = string | number | boolean;

export type Json = Primitive | Primitive[] | {[field: string]: Json} | {[field: string]: Json}[];

export type JsonObject = {[field: string]: Json};

/** WebSocket 的 connection */
type WSConnection = {
    on (event: string, handler: EventListener<any>);
    sendUTF (data: string): void;
    close (reason);
}

export type ActionRequest = {
    type: 'ActionRequest',
    command: string,
    arguments: Json[],
}

// event 應該一起訂閱。因為 event 有重送機制。如果可以分開訂閱，想像下面的場景
// 1. 鏈上現有 15 個 event。client 想訂閱 id 10 以後的 e1 及 e2 二種 event
// 2. client 送出 e1 的訂閱申請 (從 10 開始)
// 3. client 送出 e2 的訂閱申請 (從 10 開始)
// 4. agent 收到 e1 的申請，將 e1.11, e1.15 二個事件送給 client
// 5. agent 收到 e2 的申請，將 e2.12, e2.13 二個事件送給 client
// 6. 斷線!! agent 來不及將 e2.14 送給 client
// 現在 lastEventId 應該是 13 還是 15?
export type EventsRequest = {
    type: 'EventsRequest',
    lastEventId: string,                    // could be null
    events: string[],
}

type Request = ActionRequest | EventsRequest;

/**
 * Event 是包裝過的事件，是 client 有興趣監聽的
 * 例如 agent 將一個 erc20.transferd 包裝成一個 paid 事件
 * */
export type Event = {
    id: string,             // blockHash + logIndex
    event: string,
    data: Json,
    log: Log,
}

type Transformer = (log: Log, decodedData: JsonObject) => {event: string, data: Json}[];

type LogTransformer = {
    contract: string,
    eventAbi: ABIDefinition,
    transformer: Transformer,
}

function receipts (web3: Web3, block: Block) {
    const txs = block.transactions as any as string[];
    return Promise.all(txs.map(tx => web3.eth.getTransactionReceipt(tx)));
}

async function logs (web3: Web3, block: Block): Promise<Log[]> {
    return flatten((await receipts(web3, block)).map(r => r.logs));
}

function events (web3: Web3, log: Log, logTransformers: LogTransformer[]): Event[] {
    function match (transformer: LogTransformer, log: Log) {
        function eventSig1 (log: Log) {
            return log.topics ? log.topics[0] : null;
        }
        const eventSig2 = (abi: ABIDefinition) => {
            return web3.eth.abi.encodeEventSignature(r.pick(['name','type','inputs'], abi));
        }
        return eth.fmt.hex(transformer.contract) === eth.fmt.hex(log.address) &&
               eventSig2(transformer.eventAbi) === eventSig1(log)
    }
    return logTransformers
    .filter(t => match(t, log))
    .map(t => {
        const result = eth.decodeLog(web3, log, [t.eventAbi]);
        const pieces = t.transformer(log, result.parameters as JsonObject);
        return pieces.map(p => ({
            id: EventId.make(log.blockHash, log.logIndex),
            event: p.event,
            data: p.data,
            log: log,
        }))
    })
    .reduce((acc, lst) => acc.concat(lst), []);
}

const q = new SyncQueue<void>();

/* 為了測試才獨立出來 */
type ContinuableResult<T> = [T, () => Promise<ContinuableResult<T>>];
export async function _logsFrom (
        web3: Web3,
        block: number,
        logIndex: number,
        endBlock: () => number
    ): Promise<ContinuableResult<Log[]>> {
        if (endBlock() >= block) {
            const blk = await web3.eth.getBlock(block);
            const _logs = (await logs(web3, blk))
            .filter(log => log.logIndex > logIndex);
            return [_logs, () => _logsFrom(web3, block+1, -1, endBlock)];
        } else {
            return [[], null];
        }
    }

export class Agent {
    private conn: Connector = new Connector();
    private nonceAgentOf: {[sender: string]: NonceAgent} = {};
    private receiptStream: EventStream<TransactionReceipt> = new EventStream(receipt => eth.fmt.hex(receipt.transactionHash));
    private actionOf: {[command: string]: (...args: Json[]) => Promise<result.Type<Json>>} = {};
    private logTransformers: LogTransformer[] = [];
    private eventListenersOf: {[event: string]: WSConnection[]} = {};
    private confirmedBlockHead: Block = null;

    constructor (
        private makeProvider: () => Provider,
        private txHasher: (tx: Tx) => string,
        keys: Buffer[],
        confirmDepth: number,                           // 需要埋多深才算確認
    ) {
        keys.forEach(key => {
            const sender = eth.fmt.hex(ethUtils.privateToAddress(key).toString('hex'));
            this.nonceAgentOf[sender] = new NonceAgent(this.web3, key);
        });

        const bs = new BlockStream(confirmDepth);
        this.conn.onNewBlock(block => bs.inject(this.web3, block.number));
        bs.onConfirmedBlock(async block => {
            q.push(async () => {
                this.confirmedBlockHead = block;
                (await logs(this.web3, block))
                .map(log => events(this.web3, log, this.logTransformers))
                .reduce((acc, lst) => acc.concat(lst), [])
                .forEach(event => this.emit(event));
            });
        });

        bs.onConfirmedBlock(async block => {
            (await receipts(this.web3, block)).forEach(r => this.receiptStream.trigger(r));
        });
    }

    get web3 (): Web3 {
        return this.conn.web3;
    }

    private emit (event: Event) {
        (this.eventListenersOf[event.event] || [])
        .forEach(conn => conn.sendUTF(JSON.stringify(event)));
    }

    private async exec (req: ActionRequest): Promise<result.Type<Json>> {
        const handler = this.actionOf[req.command];
        if (handler) {
            return handler(...req.arguments)
            .catch(error => result.ofError<Json>(error.toString()));
        } else {
            return result.ofError(`action '${req.command}' not found`);
        }
    }

    private async setEventListener (req: EventsRequest, connection: WSConnection): Promise<result.Type<string[]>> {
        // 基本策略是先把舊的 event 傳出去後，再註冊 event listener
        // 但如果 req.lastEventId 是非常久以前的 event，第一階段的工作會花很久時間
        // 為了不阻塞其他 connection 的工作。把傳遞舊 event 的工作拆成很多塊
        const register = () => {
            // 清除原本註冊的資料
            this.eventListenersOf = r.mapObjIndexed(
                (conns, event) => conns.filter(conn => conn !== connection),
                this.eventListenersOf);
            req.events.forEach(event => {
                this.eventListenersOf[event] = (this.eventListenersOf[event] || []).concat([connection]);
            });
        }

        type Task = (logFetcher: () => Promise<ContinuableResult<Log[]>>) => Promise<any>;
        const emit: Task = async logFetcher => {
            const [ logs, next ] = await logFetcher();
            flatten(logs.map(log => events(this.web3, log, this.logTransformers)))
            .forEach(event => connection.sendUTF(JSON.stringify(event)));
            if (next !== null) {
                q.push(() => emit(next));
            } else {
                register();
            }
        }
        
        if (req.lastEventId) {
            await waitFor(() => this.confirmedBlockHead !== null, 1);
            const logIdx = EventId.logIndex(req.lastEventId);
            this.web3.eth.getBlock(EventId.block(req.lastEventId) as any)
            .then(block => {
                q.push(() => emit(() => _logsFrom(this.web3, block.number, logIdx, () => this.confirmedBlockHead.number)));
            });
        } else {
            register();
        }
        return result.of(req.events);
    }

    serve (port: number, subprotocol: string) {
        this.conn.connect(this.makeProvider);

        const server = http.createServer((_, res) => {
            // 不支援一般的 request event
            res.writeHead(404);
            res.end();
        });
        server.listen(port, function() {
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
            
            var connection = request.accept(subprotocol, request.origin) as WSConnection;
            connection.on('message', async message => {
                if (message.type !== 'utf8') {
                    connection.close(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR);
                } else {
                    const req = JSON.parse(message.utf8Data) as Request;
                    if (req.type === 'ActionRequest') {
                        const result = await this.exec(req);
                        connection.sendUTF(JSON.stringify(result));
                    } else if (req.type === 'EventsRequest') {
                        const result = await this.setEventListener(req, connection);
                        connection.sendUTF(JSON.stringify(result));
                    } else {
                        const _: never = req;
                    }
                }
            });
        });
    }

    /** helper */
    async send (sender: string, rawTx: RawTx): Promise<Result.Type<TransactionReceipt>> {
        const tx = await this.nonceAgentOf[eth.fmt.hex(sender)].send(rawTx);

        return tx
        .map(tx => this.receiptStream.waitFor(eth.fmt.hex(this.txHasher(tx))))
        .either(
            async error => Result.ofError<TransactionReceipt>(error),
            async receipt => Result.of<TransactionReceipt>(await receipt));
    }

    /** 將收到的 Log 轉成 Event */
    setLogTransformer (contract: string, eventAbi: ABIDefinition, transformer: Transformer) {
        this.logTransformers.push({contract, eventAbi, transformer});
    }

    setAction (command: string, handler: (...args: Json[]) => Promise<result.Type<Json>>) {
        this.actionOf[command] = handler;
    }
}
