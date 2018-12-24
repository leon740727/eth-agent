import * as r from 'ramda';
import Web3 = require('web3');
import { Tx } from 'eth-utils';
import * as eth from 'eth-utils';
import * as ethUtils from 'ethereumjs-util';
import uuidv1 = require('uuid/v1');
import * as utils from './utils';
import EventStream from './event-stream';

/** todo: 沒考慮分叉的狀況 */
/** todo: 重啟會有交易遺失 => 日後手動處理 */
/** todo: 優雅的退出 */

type Num = string | number;

/** 沒有 nonce 也沒有簽名的 tx */
export type RawTx = {
    gasPrice?: Num;
    gasLimit?: Num;
    to?: string;
    value?: Num;
    data?: string;
};

export { Tx } from 'eth-utils';

type Listener <T> = (id: string, data: T) => void;

class JobQueue <T> {
    private jobs: Promise<void> = Promise.resolve(null);
    constructor (private handler: (data: T) => Promise<void>) {};

    push (data: T) {
        this.jobs = this.jobs.then(_ => this.handler(data));
    }
}

type Event <T> = {
    id: string,
    data: T,
}

export class NonceAgent {
    private nonce: number = null;
    private jobIds: string[] = [];
    private jobs: JobQueue<RawTx> = new JobQueue(rawTx => {
        return this.resolve(rawTx)
        .then(tx => {
            const jid = this.jobIds.shift();
            this.listeners.forEach(l => l(jid, tx));
        });
    });
    private listeners: Listener<Tx>[] = [];

    private txStream: EventStream<Event<Tx>> = new EventStream<Event<Tx>>(event => event.id);

    constructor (
        private web3: Web3,
        private key: Buffer,
    ) {
        this.onTx((jid, tx) => this.txStream.trigger({id: jid, data: tx}));
    }

    push (jobId: string, rawTx: RawTx) {
        this.jobIds.push(jobId);
        this.jobs.push(rawTx);
    }

    /** 注意!!這個 Tx 還沒 send 出去，查不到 receipt */
    send (rawTx: RawTx): Promise<Tx> {
        const jid = uuidv1();
        this.push(jid, rawTx);
        return this.txStream.waitFor(jid).then(event => event.data);
    }

    onTx (listener: Listener<Tx>) {
        this.listeners.push(listener);
    }

    private async resolve (rawTx: RawTx): Promise<Tx> {
        const tryNonce: (rawTx: RawTx) => Promise<Tx> = async raw => {
            await utils.wait(5);              // 預防分叉
            const addr = '0x' + ethUtils.privateToAddress(this.key).toString('hex');
            const nonce = await this.web3.eth.getTransactionCount(addr);
            const tx = eth.sign(this.key, r.assoc('nonce', nonce, rawTx));
            return this.web3.eth.sendSignedTransaction(eth.serialize(tx))
            .then(_ => tx)
            .catch((error: Error) => {
                // the tx doesn't have the correct nonce. account has nonce of: 50 tx has nonce of: 49
                if (error.message.match(/nonce/)) {     // nonce 錯誤
                    return tryNonce(rawTx);
                } else {
                    return tx;
                }
            });
        }
        if (this.nonce === null) {
            const tx = await tryNonce(rawTx);
            this.nonce = (typeof tx.nonce === 'number' ? tx.nonce : parseInt(tx.nonce)) + 1;
            return tx;
        } else {
            const tx = eth.sign(this.key, r.assoc('nonce', this.nonce, rawTx));
            this.nonce += 1;
            // 不需 await
            this.web3.eth.sendSignedTransaction(eth.serialize(tx))
            .catch(_ => _);
            return tx;
        }
    }
}
