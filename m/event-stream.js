"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const r = require("ramda");
function clean(obj) {
    const pairs = r.toPairs(obj)
        .filter(([key, value]) => value !== undefined);
    return r.fromPairs(pairs);
}
const transhCapacity = 10;
class default_1 {
    constructor(getType) {
        this.getType = getType;
        this.transhCount = 0;
        this.listeners = {};
        this.onceListeners = {};
    }
    trigger(event) {
        const type = this.getType(event);
        (this.listeners[type] || []).concat(this.onceListeners[type] || [])
            .forEach(listener => listener(event));
        this.cleanOnceListeners(type);
    }
    on(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).concat([handler]);
    }
    once(type, handler) {
        this.onceListeners[type] = (this.onceListeners[type] || []).concat([handler]);
    }
    waitFor(type) {
        return new Promise((resolve, reject) => {
            this.once(type, event => resolve(event));
        });
    }
    cleanOnceListeners(type) {
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
exports.default = default_1;
