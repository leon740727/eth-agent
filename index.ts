import * as r from 'ramda';
import Web3 = require('web3');
import { Log, TransactionReceipt } from 'web3/types';
import { Block } from 'web3/eth/types';
import { ABIDefinition  } from 'web3/eth/abi';
import { Provider } from 'web3/providers';
import http = require('http');
import * as utils from 'eth-utils';
import Connector from './connector';
import BlockStream from './m/block-stream';
import * as result from './m/result';
import { EventListener, flatten } from './m/utils';
const WebSocketServer = require('websocket').server;
const WebSocketConnection = require('websocket').connection;

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
    lastEventId: string,
    events: string[],
}

type Request = ActionRequest | EventsRequest;

/**
 * Event 是包裝過的事件，是 client 有興趣監聽的
 * 例如 agent 將一個 erc20.transferd 包裝成一個 paid 事件
 * Event.id = LogEvent.id
 * */
export type Event = {
    event: string,
    id: string,
    data: Json,
}

/**
 * LogEvent 是鏈上原始的事件
 * LogEvent.id = block + ',' + tx + ',' + log
 * block = 發出這個 log 的 block number
 * tx = 發出這個 log 的 tx 在 block 裡的位置
 * log = 這個 log 在 tx 裡的位置
 * */
type LogEvent = {
    id: string,
    data: JsonObject,
}

type LogListener = {
    contract: string,
    abi: ABIDefinition,
    cb: EventListener<LogEvent>,
}

function toAddress (address: string) {
    return address.slice(-40).toLowerCase();
}

async function processLog (web3: Web3, block: Block, logListeners: LogListener[]) {
    function getLogs (receipt: TransactionReceipt, receiptIdx: number): [string, Log][] {
        const logs = receipt.logs || [];
        const logIdxs = r.range(0, logs.length);
        return r.zip(logs, logIdxs)
        .map(([log, logIdx]) => {
            const logId = [block.number, receiptIdx, logIdx].join(',');
            return [logId, log] as [string, Log];
        });
    }
    const receipts = await Promise.all(block.transactions.map(tx => web3.eth.getTransactionReceipt(tx.hash)));
    const rIdxs = r.range(0, receipts.length);
    const logs = flatten(r.zip(receipts, rIdxs).map(([r, ridx]) => getLogs(r, ridx)));
    logs.forEach(([lid, log]) => {
        logListeners
        .filter(listener => toAddress(listener.contract) === toAddress(log.address))
        .forEach(listener => {
            const data = utils.decodeLog(web3, log, [listener.abi]);
            // todo: data 會是 null 嗎?
            if (data) {
                const logEvent: LogEvent = {
                    id: lid,
                    data: data.parameters as JsonObject,
                };
                listener.cb(logEvent);
            }
        });
    });
}

export class Agent {
    private conn: Connector = new Connector();
    private actionOf: {[command: string]: (args: Json[]) => Promise<result.Type<Json>>} = {};
    private logListeners: LogListener[] = [];
    private eventListenersOf: {[event: string]: WSConnection[]} = {};

    constructor (
        private makeProvider: () => Provider,
        confirmDepth: number,                           // 需要埋多深才算確認
    ) {
        const bs = new BlockStream(confirmDepth);
        this.conn.onNewBlock(block => bs.inject(this.web3, block.number));
        bs.onConfirmedBlock(block => processLog(this.web3, block, this.logListeners));
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

    /** 當 ethereum 節點收到某個合約的某個 event 時觸發 */
    on (contract: string, abi: ABIDefinition, cb: EventListener<LogEvent>) {
        this.logListeners.push({contract, abi, cb});
    }

    /** 向 connection 發出 (包裝過的) 事件 */
    emit (event: string, logEvent: LogEvent, data: Json): void {
        const e: Event = {
            id: logEvent.id,
            event,
            data,
        };
        (this.eventListenersOf[event] || [])
        .forEach(connection => connection.sendUTF(JSON.stringify(e)));
    }

    setAction (command: string, handler: (args: Json[]) => Promise<result.Type<Json>>) {
        this.actionOf[command] = handler;
    }
}
