import * as r from 'ramda';
import Web3 = require('web3');
import { ABIDefinition  } from 'web3/eth/abi';
import { Provider } from 'web3/providers';
import http = require('http');
import * as utils from 'eth-utils';
import Connector from './connector';
const WebSocketServer = require('websocket').server;
const WebSocketConnection = require('websocket').connection;

type Primitive = string | number | boolean;

export type Json = Primitive | Primitive[] | {[field: string]: Json} | {[field: string]: Json}[];

export type JsonObject = {[field: string]: Json};

type Connection = {
    on (event: string, handler: (msg) => void);
    sendUTF (data: string): void;
    close (reason);
}

export type ActionRequest = {
    type: 'ActionRequest',
    command: string,
    arguments: Json[],
}

export type EventRequest = {
    type: 'EventRequest',
    event: string,
}

type Request = ActionRequest | EventRequest;

export type ActionResult = {
    error: string,
    data: Json,
}

export type RegisterEventResult = {
    error: string,
    event: string,
}

export type Event = {
    event: string,
    data: Json,
}

type LogListener = {
    contract: string,
    abi: ABIDefinition,
    cb: (data: JsonObject) => void,
}

function toAddress (address: string) {
    return address.slice(-40).toLowerCase();
}

export class Agent {
    private conn: Connector = new Connector();
    private actionOf: {[command: string]: (args: Json[]) => Promise<ActionResult>} = {};
    private logListeners: LogListener[] = [];
    private eventListenersOf: {[event: string]: Connection[]} = {};

    constructor (
        private makeProvider: () => Provider,
    ) {
        this.conn.onNewBlock(async block => {
            const count = await this.web3.eth.getBlockTransactionCount(block.hash);
            const idxs = r.range(0, count);
            const txs = await Promise.all(idxs.map(i => this.web3.eth.getTransactionFromBlock(block.hash as any, i)));
            const receipts = await Promise.all(txs.map(tx => this.web3.eth.getTransactionReceipt(tx.hash)));
            const logs = receipts.map(r => r.logs || []).reduce((acc, i) => acc.concat(i), []);
            logs.forEach(log => {
                this.logListeners
                .filter(listener => toAddress(listener.contract) === toAddress(log.address))
                .forEach(listener => {
                    const data = utils.decodeLog(this.web3, log, [listener.abi]);
                    if (data) {
                        listener.cb(data.parameters as JsonObject);
                    }
                });
            });
        });
    }

    get web3 (): Web3 {
        return this.conn.web3;
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
            
            var connection = request.accept(subprotocol, request.origin) as Connection;
            connection.on('message', message => {
                if (message.type !== 'utf8') {
                    connection.close(WebSocketConnection.CLOSE_REASON_PROTOCOL_ERROR);
                } else {
                    const req = JSON.parse(message.utf8Data) as Request;
                    if (req.type === 'ActionRequest') {
                        const handler = this.actionOf[req.command];
                        if (handler) {
                            handler(req.arguments)
                            .then(result => connection.sendUTF(JSON.stringify(result)))
                            .catch(error => connection.sendUTF(JSON.stringify({
                                error: error.toString(),
                                data: null,
                            } as ActionResult)))
                        } else {
                            connection.sendUTF(JSON.stringify({
                                error: `action '${req.command}' not found`,
                                data: null,
                            } as ActionResult));
                        }
                    } else if (req.type === 'EventRequest') {
                        this.eventListenersOf[req.event] = (this.eventListenersOf[req.event] || [])
                        .concat([ connection ]);
                        connection.sendUTF(JSON.stringify({
                            error: null,
                            event: req.event,
                        } as RegisterEventResult));
                    } else {
                        const _: never = req;
                    }
                }
            });
        });
    }

    /** 當 ethereum 節點收到某個合約的某個 event 時觸發 */
    on (contract: string, abi: ABIDefinition, cb: (data: JsonObject) => void) {
        this.logListeners.push({contract, abi, cb});
    }

    /** 向 connection 發出 (包裝過的) 事件 */
    emit (event: string, data: Json): void {
        (this.eventListenersOf[event] || [])
        .forEach(connection => connection.sendUTF(JSON.stringify({
            event,
            data: data,
        } as Event)));
    }

    setAction (command: string, handler: (args: Json[]) => Promise<ActionResult>) {
        this.actionOf[command] = handler;
    }
}
