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
const assert = require("assert");
class default_1 {
    constructor(confirmDepth) {
        this.confirmDepth = confirmDepth;
        this.head = null; // 最新的 confirmed block
        this.listeners = [];
    }
    /** 注入 unconfirmed block */
    inject(web3, unconfirmedBlock) {
        return __awaiter(this, void 0, void 0, function* () {
            const h2 = unconfirmedBlock - this.confirmDepth;
            if (this.head) {
                assert.ok(unconfirmedBlock > this.head.number, 'confirm depth 不夠深');
                if (h2 > this.head.number) { // 新的 confirmed block 產生了
                    const newbies = r.range(this.head.number + 1, h2 + 1);
                    this.publish(yield Promise.all(newbies.map(b => web3.eth.getBlock(b))));
                }
            }
            else {
                this.publish([yield web3.eth.getBlock(h2)]);
            }
        });
    }
    onConfirmedBlock(listener) {
        this.listeners.push(listener);
    }
    publish(confirmedBlocks) {
        // inject 到 publish 的過程是非同步的。中間 head 的狀態可能被改變
        // 所以在真正修改 head 前要篩選一遍
        if (this.head) {
            confirmedBlocks = confirmedBlocks.filter(b => b.number > this.head.number);
        }
        if (confirmedBlocks.length > 0) {
            this.head = r.last(confirmedBlocks);
            confirmedBlocks.map(b => this.listeners.forEach(l => l(b)));
        }
    }
}
exports.default = default_1;
