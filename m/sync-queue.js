"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class default_1 {
    constructor() {
        this.jobs = Promise.resolve(null);
    }
    push(job) {
        return new Promise((resolve, reject) => {
            this.jobs = this.jobs.then(_ => job().then(resolve));
        });
    }
}
exports.default = default_1;
