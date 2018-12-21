import * as r from 'ramda';
import Web3 = require('web3');
import * as ethUtils from 'ethereumjs-util';
import EthTx = require("ethereumjs-tx");
import uuidv1 = require('uuid/v1');
import * as utils from './utils';
import EventStream from './event-stream';

/** todo: 沒考慮分叉的狀況 */
/** todo: 重啟會有交易遺失 => 日後手動處理 */
/** todo: 優雅的退出 */

type Listener <T> = (id: string, data: T) => void;

export type RawTx = {
    to: string,
    data: string,
    value: string,
    gasPrice: string,
    gasLimit: string,
}

export interface Tx extends RawTx {
    nonce: Buffer,
    _fields: string[],
    sign (key: Buffer): void,
    hash (includeSignature: boolean): Buffer,
    serialize (): Buffer,
    toJSON (): string[],
}

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

function sign (rawTx: RawTx, nonce: number, key: Buffer): Promise<Tx> {
    const tx = new EthTx(r.merge({ nonce }, rawTx)) as any as Tx;
    tx.sign(key);
    return Promise.resolve(tx);
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
            const tx = await sign(rawTx, nonce, this.key);
            return this.web3.eth.sendSignedTransaction(`0x${tx.serialize().toString('hex')}`)
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
            this.nonce = (tx.nonce.length === 0 ? 0 : parseInt(tx.nonce.toString('hex'), 16)) + 1;
            return tx;
        } else {
            const tx = await sign(rawTx, this.nonce, this.key);
            this.nonce += 1;
            // 不需 await
            this.web3.eth.sendSignedTransaction(`0x${tx.serialize().toString('hex')}`)
            .catch(_ => _);
            return tx;
        }
    }
}
