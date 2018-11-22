const W3CWebSocket = require('websocket').w3cwebsocket;
import { ActionRequest, EventRequest, ActionResult, RegisterEventResult, Event, Json } from '../index';

function _connect (url: string, subprotocol: string): Promise<any> {
    var conn = new W3CWebSocket(url, subprotocol);
    conn.onerror = () => {
        throw new Error('w3cwebsocket error');
    };
    return new Promise((resolve, reject) => {
        conn.onopen = () => {
            resolve(conn);
        }
    });
}

function isRegisterEventResult (data): boolean {
    return data.error !== undefined;
}

class EventConnection {
    private conn;
    private handlerOf: {[event: string]: (data: Json) => void} = {};

    connect (url: string): Promise<void> {
        return _connect(url, '')
        .then(conn => {
            this.conn = conn;
            this.conn.onmessage = e => {
                const result = JSON.parse(e.data);
                if (isRegisterEventResult(result)) {
                    const res = result as RegisterEventResult;
                    if (res.error) {
                        throw new Error(`register ${res.event} event fail: ${res.error}`);
                    }
                } else {
                    const res = result as Event;
                    this.handlerOf[res.event](res.data);
                }
            }
        });
    }

    close () {
        this.conn.close();
    }

    on (event: string, handler: (data: Json) => void) {
        this.handlerOf[event] = handler;
        const req: EventRequest = {
            type: 'EventRequest',
            event,
        }
        this.conn.send(JSON.stringify(req));
    }
}

function exec (command: string, args: Json[]): Promise<ActionResult> {
    return _connect(agentUrl, '')
    .then(conn => {
        const req: ActionRequest = {
            type: 'ActionRequest',
            command,
            arguments: args,
        }
        conn.send(JSON.stringify(req));
        return new Promise<ActionResult>((resolve, reject) => {
            conn.onmessage = e => {
                const result = JSON.parse(e.data) as ActionResult;
                conn.close();
                resolve(result);
            }
        });
    });
}


const agentUrl = 'ws://localhost:8080/';
const ec = new EventConnection();
ec.connect(agentUrl)
.then(_ => ec.on('add', (value: number) => {
    console.log(`add`, value);
    ec.close();
}));

exec('add', [27]).then(result => console.log('result:', result));
