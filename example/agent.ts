import * as fs from 'fs';
import Web3 = require('web3');
import { ABIDefinition  } from 'web3/eth/abi';
import { BigNumber } from 'bignumber.js';
import { Agent, Result, RawTx } from '../index';
import * as utils from '../m/utils';

type Resource = {abi: ABIDefinition[], bytecode: string}

const testAddr = '0x345ca3e014aaf5dca488057592ee47305d9b3e10';
const testResource: Resource = JSON.parse(fs.readFileSync('./build/contracts/Test.json', 'utf-8'));

const admin = '0x627306090abab3a6e1400e9345bc60c78a8bef57';
const adminKey = Buffer.from('c87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3', 'hex');

const settings = {
    gasPrice: '100000000000',
    gasLimit: '6000000',
}

function makeTx (key: Buffer, to: string, value: number|string, data: string): RawTx {
    return {
        to: to === null ? undefined : to,
        data: data,
        value: '0x' + new BigNumber(value).toString(16),
        gasPrice: '0x' + new BigNumber(settings.gasPrice).toString(16),
        gasLimit: '0x' + new BigNumber(settings.gasLimit).toString(16),
    };
}

const agent = new Agent(
    () => new Web3.providers.WebsocketProvider('ws://localhost:9545'),
    utils.fakeTxHasher,
    [adminKey],
    0);

agent.setAction('nonce', async ([address]: [string]) => {
    return {
        error: null,
        data: await agent.web3.eth.getTransactionCount(address),
    }
});

agent.setLogTransformer(
    testAddr,
    testResource.abi.filter(abi => abi.type === 'event' && abi.name === 'Add')[0],
    (log, data) => [{event: 'add', data: data.value}]);

agent.setAction('add', async (value: number) => {
    const test = new agent.web3.eth.Contract(testResource.abi, testAddr);
    const receipt = await agent.send(admin, makeTx(adminKey, testAddr, 0, test.methods.add(value).encodeABI()));
    return Result.of(value);
});

agent.serve(8080, '');
