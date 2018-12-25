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
import * as result from './m/result';
import { EventListener, flatten } from './m/utils';
const WebSocketServer = require('websocket').server;
const WebSocketConnection = require('websocket').connection;

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

async function events (web3: Web3, block: Block, logTransformers: LogTransformer[]): Promise<Event[]> {
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
    function events (log: Log): Event[] {
        return flatten(logTransformers
            .filter(t => match(t, log))
            .map(t => {
                const result = eth.decodeLog(web3, log, [t.eventAbi]);
                const pieces = t.transformer(log, result.parameters as JsonObject);
                return pieces.map(p => ({
                    id: log.blockHash + ',' + log.logIndex,
                    event: p.event,
                    data: p.data,
                    log: log,
                }));
            }));
    }
    const receipts = await Promise.all((block.transactions as any as string[]).map(tx => web3.eth.getTransactionReceipt(tx)));
    const logs = flatten(receipts.map(r => r.logs || []));
    return flatten(logs.map(events));
}

export class Agent {
    private conn: Connector = new Connector();
    private nonceAgentOf: {[sender: string]: NonceAgent} = {};
    private receiptStream: EventStream<TransactionReceipt> = new EventStream(receipt => eth.fmt.hex(receipt.transactionHash));
    private actionOf: {[command: string]: (args: Json[]) => Promise<result.Type<Json>>} = {};
    private logTransformers: LogTransformer[] = [];
    private eventListenersOf: {[event: string]: WSConnection[]} = {};

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
            (await events(this.web3, block, this.logTransformers))
            .forEach(event => {
                (this.eventListenersOf[event.event] || [])
                .forEach(conn => conn.sendUTF(JSON.stringify(event)));
            });
        });

        bs.onConfirmedBlock(async block => {
            const receipts = await Promise.all((block.transactions as any as string[]).map(tx => this.web3.eth.getTransactionReceipt(tx)));
            receipts.forEach(r => this.receiptStream.trigger(r));
        });
    }

    get web3 (): Web3 {
        return this.conn.web3;
    }

    private async exec (req: ActionRequest): Promise<result.Type<Json>> {
        const handler = this.actionOf[req.command];
        if (handler) {
            return handler(req.arguments)
            .catch(error => result.ofError<Json>(error.toString()));
        } else {
            return result.ofError(`action '${req.command}' not found`);
        }
    }

    private addEventListener (req: EventsRequest, connection: WSConnection): result.Type<string[]> {
        req.events.forEach(event => {
            this.eventListenersOf[event] = (this.eventListenersOf[event] || []).concat([connection]);
        });
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
                        const result = this.addEventListener(req, connection);
                        connection.sendUTF(JSON.stringify(result));
                    } else {
                        const _: never = req;
                    }
                }
            });
        });
    }

    /** helper */
    async send (sender: string, rawTx: RawTx): Promise<TransactionReceipt> {
        const tx = await this.nonceAgentOf[eth.fmt.hex(sender)].send(rawTx);
        return this.receiptStream.waitFor(eth.fmt.hex(this.txHasher(tx)));
    }

    /** 將收到的 Log 轉成 Event 發出 */
    on (contract: string, eventAbi: ABIDefinition, transformer: Transformer) {
        this.logTransformers.push({contract, eventAbi, transformer});
    }

    setAction (command: string, handler: (args: Json[]) => Promise<result.Type<Json>>) {
        this.actionOf[command] = handler;
    }
}
