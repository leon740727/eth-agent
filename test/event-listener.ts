import { expect } from 'chai';
import * as r from 'ramda';
import * as fs from 'fs';
import Web3 = require('web3');
import { Log, TransactionReceipt } from 'web3/types';
import { ABIDefinition  } from 'web3/eth/abi';
import Contract from 'web3/eth/contract';
import * as eth from 'eth-utils';
import { privateToAddress } from 'ethereumjs-util';
import Task from '../m/sync-queue';
import { RawTx } from '../m/nonce-agent';
import { _logsFrom } from '../';

const web3Provider = 'http://localhost:9545';

const [ gasPrice, gasLimit ] = [ 0, 6000000 ];

declare const describe, it, before, after, afterEach;

type Resource = {abi: ABIDefinition[], bytecode: string}

const resource: Resource = JSON.parse(fs.readFileSync('./build/contracts/Test.json', 'utf-8'));

describe('event listener', () => {
    let web3: Web3;
    const key = Buffer.from('c87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3', 'hex');
    const admin = privateToAddress(key).toString('hex');
    let contract: Contract;

    function makeTx (n: number): RawTx {
        return {
            to: contract.options.address,
            data: contract.methods.add(n).encodeABI(),
            gasPrice,
            gasLimit,
        }
    }

    before(async () => {
        web3 = new Web3(web3Provider);
        const nonce = await web3.eth.getTransactionCount(admin);
        contract = await eth.deploy(web3, key, resource.abi, resource.bytecode, [0], nonce, gasPrice, gasLimit);
    });

    after(() => (web3.currentProvider as any).disconnect());

    it('_logsFrom', async () => {
        const nonce = await web3.eth.getTransactionCount(admin);
        const txs = [
            r.assoc('nonce', nonce + 0, makeTx(1)),
            r.assoc('nonce', nonce + 1, makeTx(2)),
            r.assoc('nonce', nonce + 2, makeTx(3)),
            r.assoc('nonce', nonce + 3, makeTx(4)),
            r.assoc('nonce', nonce + 4, makeTx(5)),
        ]
        .map(raw => eth.sign(key, raw));
        // 依序執行才不會遇到 nonce 的問題
        const task = new Task<TransactionReceipt>();
        const [r1, r2, r3, r4, r5] = await Promise.all(txs.map(tx => task.push(() => web3.eth.sendSignedTransaction(eth.serialize(tx)))));
        let logs: Log[] = null;
        let next: () => Promise<any> = null;

        // tx 1
        [ logs, next ] = await _logsFrom(web3, r1.blockNumber, r1.logs[0].logIndex, () => r3.blockNumber);
        expect(logs.length).eql(0);
        expect(next !== null, 'tx 1').eql(true);

        // tx 2
        [ logs, next ] = await next();
        expect(logs.length).eql(1);
        expect(next !== null, 'tx 2').eql(true);

        // tx 3
        [ logs, next ] = await next();
        expect(logs.length).eql(1);
        expect(next !== null, 'tx 3').eql(true);

        // tx 4
        [ logs, next ] = await next();
        expect(logs.length).eql(0);
        expect(next === null, 'tx 4').eql(true);
    });
});
