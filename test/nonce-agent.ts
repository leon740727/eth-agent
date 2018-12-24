import * as r from 'ramda';
import { expect } from 'chai';
import Web3 = require('web3');
import * as sinon from 'sinon';
import * as eth from 'eth-utils';
import * as utils from '../m/utils';
import { NonceAgent, RawTx, Tx } from '../m/nonce-agent';

declare const describe, it, before, after, afterEach;

const web3Provider = 'http://localhost:9545';

function replaceOnce (object, property, func) {
    const ori = object[property];
    sinon.replace(object, property, (...args) => {
        func.apply(null, args);
        object[property] = ori;
    });
}

describe('nonce agent', () => {
    const web3 = new Web3(web3Provider);

    const [leon, iris] = [
        '0x627306090abab3a6e1400e9345bc60c78a8bef57',
        '0xf17f52151ebef6c7334fad080c5704d77216b732',
    ];
    const leonKey = Buffer.from('c87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3', 'hex');

    function makeTx (value: number): RawTx {
        return {
            to: iris,
            value: value,
            gasPrice: 0,
            gasLimit: 6000000,
        };
    }

    it('', async () => {
        // 準備一筆資料，確定 nonce 不為 0
        const nonce = await web3.eth.getTransactionCount(leon);
        const tx = eth.sign(leonKey, r.assoc('nonce', nonce, makeTx(nonce)));
        await web3.eth.sendSignedTransaction(eth.serialize(tx));
        
        const nonces = r.range(nonce+1, nonce+3);
        const txs = nonces.map(n => makeTx(n));

        let waitCount = 0;
        sinon.replace(utils, 'wait', (sec: number, v: any) => {
            return new Promise((resolve, reject) => {
                waitCount += 1;
                setTimeout(() => resolve(v), 0);
            });
        });
        replaceOnce(web3.eth, 'getTransactionCount', addr => Promise.resolve(0));

        const agent = new NonceAgent(web3, leonKey);
        return new Promise((resolve, reject) => {
            const results: Tx[] = [];
            agent.onTx((jid, tx) => {
                results.push(tx);
                if (results.length === txs.length) {
                    results.forEach(r => {
                        expect(r.nonce).eql(r.value);
                    });
                    expect(waitCount).eql(2);
                    setTimeout(() => resolve(), 1000);       // 第二個交易不用等完成就會傳出 tx
                }
            });
            txs.forEach(tx => agent.push(null, tx));
        });
    });

    it('job id', done => {
        sinon.replace(utils, 'wait', (sec, v) => Promise.resolve(v));
        const agent = new NonceAgent(web3, leonKey);
        const results = [];
        agent.onTx((jid, tx) => {
            results.push(jid);
            if (results.length === 3) {
                expect(results).eql(['j1','j2','j3']);
                setTimeout(() => done(), 1000);       // 第二個交易不用等完成就會傳出 tx
            }
        });
        agent.push('j1', makeTx(1));
        agent.push('j2', makeTx(2));
        agent.push('j3', makeTx(2));
    });
    
    afterEach(() => sinon.restore());

    after(() => (web3.currentProvider as any).disconnect());
});
