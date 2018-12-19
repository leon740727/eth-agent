import { w3cwebsocket as W3CWebSocket } from 'websocket';
import { ActionRequest, EventsRequest, Result, Event, Json } from '../index';
import { EventListener } from '../m/utils';
import EventStream from '../m/event-stream';

function connect (url: string, subprotocol: string): Promise<W3CWebSocket> {
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

class EventConnection {
    private conn: W3CWebSocket;
    private handlerOf: {[event: string]: (event: Event) => void} = {};
    private eventStream = new EventStream<Json>(e => 'm');

    connect (url: string): Promise<void> {
        return connect(url, '')
        .then(conn => {
            this.conn = conn;
            this.conn.onmessage = e => this.eventStream.trigger(JSON.parse(e.data));
        });
    }

    close () {
        this.conn.close();
    }

    async setListeners (listeners: {event: string, handler: EventListener<Event>}[]): Promise<Result.Type<string[]>> {
        listeners.forEach(l => this.handlerOf[l.event] = l.handler);
        const req: EventsRequest = {
            type: 'EventsRequest',
            events: listeners.map(l => l.event),
            lastEventId: null,
        }
        this.conn.send(JSON.stringify(req));
        const res = await this.eventStream.waitFor('m') as Result.Type<string[]>;
        this.eventStream.on('m', e => this.handlerOf[(e as any as Event).event](e as any))
        return res;
    }
}

function exec (command: string, args: Json[]): Promise<Result.Type<Json>> {
    return connect(agentUrl, '')
    .then(conn => {
        const req: ActionRequest = {
            type: 'ActionRequest',
            command,
            arguments: args,
        }
        conn.send(JSON.stringify(req));
        return new Promise<Result.Type<Json>>((resolve, reject) => {
            conn.onmessage = e => {
                const result = JSON.parse(e.data) as Result.Type<Json>;
                conn.close();
                resolve(result);
            }
        });
    });
}


const agentUrl = 'ws://localhost:8080/';
const ec = new EventConnection();
ec.connect(agentUrl)
.then(_ => {
    ec.setListeners([{event: 'add', handler: e => console.log(`event: `, e)}])
    .then(res => console.log(`setListeners: `, res));
});

exec('add', [27]).then(result => console.log(`exec: `, result));
