import * as r from 'ramda';

type Handler <T> = (data: T) => void;

function clean <T> (obj: {[key: string]: T}): {[key: string]: T} {
    const pairs = r.toPairs(obj)
    .filter(([key, value]) => value !== undefined);
    return r.fromPairs(pairs);
}

const transhCapacity = 10;

export default class <T> {
    private transhCount = 0;
    private listeners: {[type: string]: Handler<T>[]} = {};
    private onceListeners: {[type: string]: Handler<T>[]} = {};

    constructor (
        public getType: (event: T) => string,
    ) {}

    trigger (event: T): void {
        const type = this.getType(event);

        (this.listeners[type] || []).concat(this.onceListeners[type] || [])
        .forEach(listener => listener(event));

        this.cleanOnceListeners(type);
    }

    on (type: string, handler: Handler<T>) {
        this.listeners[type] = (this.listeners[type] || []).concat([handler]);
    }

    once (type: string, handler: Handler<T>) {
        this.onceListeners[type] = (this.onceListeners[type] || []).concat([handler]);
    }

    waitFor (type: string): Promise<T> {
        return new Promise((resolve, reject) => {
            this.once(type, event => resolve(event));
        });
    }

    private cleanOnceListeners (type: string) {
        if (this.onceListeners[type]) {
            this.onceListeners[type] = undefined;
            this.transhCount += 1;
        }
        if (this.transhCount > transhCapacity) {
            this.onceListeners = clean(this.onceListeners);
            this.transhCount = 0;
        }
    }
}
