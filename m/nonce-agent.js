"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const r = require("ramda");
const types_1 = require("types");
const eth = require("eth-utils");
const ethUtils = require("ethereumjs-util");
const uuidv1 = require("uuid/v1");
const utils = require("./utils");
const event_stream_1 = require("./event-stream");
class JobQueue {
    constructor(handler) {
        this.handler = handler;
        this.jobs = Promise.resolve(null);
    }
    ;
    push(data) {
        this.jobs = this.jobs.then(_ => this.handler(data));
    }
}
class NonceAgent {
    constructor(web3, key) {
        this.web3 = web3;
        this.key = key;
        this.nonce = null;
        this.jobIds = [];
        this.jobs = new JobQueue(rawTx => {
            return this.resolve(rawTx)
                .then(tx => {
                const jid = this.jobIds.shift();
                this.listeners.forEach(l => l(jid, tx));
            });
        });
        this.listeners = [];
        this.txStream = new event_stream_1.default(event => event.id);
        this.onTx((jid, tx) => this.txStream.trigger({ id: jid, data: tx }));
    }
    push(jobId, rawTx) {
        this.jobIds.push(jobId);
        this.jobs.push(rawTx);
    }
    /** 注意!!這個 Tx 還沒 send 出去，查不到 receipt */
    send(rawTx) {
        const jid = uuidv1();
        this.push(jid, rawTx);
        return this.txStream.waitFor(jid).then(event => event.data);
    }
    onTx(listener) {
        this.listeners.push(listener);
    }
    resolve(rawTx) {
        return __awaiter(this, void 0, void 0, function* () {
            // 交易的完整流程如下: RawTx => Tx => Receipt
            // 但交易上了鏈才會有 Receipt，而上鏈的時間很難估計
            // 所以 resolve 不會等待 Receipt，只要能得到正確的 Tx 就夠了 (nonce 不會太低，沒有超出 gas limit...)
            const tryNonce = (raw) => __awaiter(this, void 0, void 0, function* () {
                yield utils.wait(5); // 預防分叉
                const addr = '0x' + ethUtils.privateToAddress(this.key).toString('hex');
                const nonce = yield this.web3.eth.getTransactionCount(addr);
                const tx = eth.sign(this.key, r.assoc('nonce', nonce, rawTx));
                return new Promise((resolve, reject) => {
                    this.web3.eth.sendSignedTransaction(eth.serialize(tx))
                        .on('transactionHash', _ => resolve(types_1.Result.ok(tx)))
                        .on('error', error => {
                        // the tx doesn't have the correct nonce. account has nonce of: 50 tx has nonce of: 49
                        if (error.message.match(/nonce/)) { // nonce 錯誤
                            tryNonce(rawTx).then(resolve);
                        }
                        else {
                            resolve(types_1.Result.fail(error.message));
                        }
                    });
                });
            });
            if (this.nonce === null) {
                const tx = yield tryNonce(rawTx);
                this.nonce = tx
                    .map(tx => (typeof tx.nonce === 'number' ? tx.nonce : parseInt(tx.nonce)) + 1)
                    .or_else(this.nonce);
                return tx;
            }
            else {
                const tx = eth.sign(this.key, r.assoc('nonce', this.nonce, rawTx));
                // 不需 await
                return new Promise((resolve, reject) => {
                    this.web3.eth.sendSignedTransaction(eth.serialize(tx))
                        .on('transactionHash', _ => {
                        this.nonce += 1;
                        resolve(types_1.Result.ok(tx));
                    })
                        .on('error', error => resolve(types_1.Result.fail(error.message)));
                });
            }
        });
    }
}
exports.NonceAgent = NonceAgent;
