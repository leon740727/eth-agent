"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class default_1 {
    constructor() {
        this.jobs = Promise.resolve(null);
    }
    push(job) {
        this.jobs = this.jobs.then(_ => job());
    }
}
exports.default = default_1;
