import * as r from 'ramda';
import Web3 = require('web3');
import * as assert from 'assert';
import { Block } from 'web3/eth/types';
import { EventListener } from './utils';

export default class {
    private head: Block = null;                 // 最新的 confirmed block
    private listeners: EventListener<Block>[] = [];

    constructor (private confirmDepth: number) {}

    /** 注入 unconfirmed block */
    async inject (web3: Web3, unconfirmedBlock: number): Promise<void> {
        const h2 = unconfirmedBlock - this.confirmDepth;
        if (this.head) {
            assert.ok(unconfirmedBlock > this.head.number, 'confirm depth 不夠深');
            if (h2 > this.head.number) {          // 新的 confirmed block 產生了
                const newbies = r.range(this.head.number + 1, h2 + 1);
                this.publish(await Promise.all(newbies.map(b => web3.eth.getBlock(b))));
            }
        } else {
            this.publish([await web3.eth.getBlock(h2)]);
        }
    }

    onConfirmedBlock (listener: EventListener<Block>) {
        this.listeners.push(listener);
    }

    private publish (confirmedBlocks: Block[]) {
        // inject 到 publish 的過程是非同步的。中間 head 的狀態可能被改變
        // 所以在真正修改 head 前要篩選一遍
        confirmedBlocks = confirmedBlocks.filter(b => b.number > this.head.number);
        if (confirmedBlocks.length > 0) {
            this.head = r.last(confirmedBlocks);
            confirmedBlocks.map(b => this.listeners.forEach(l => l(b)));
        }
    }
}
