import * as r from 'ramda';
import Web3 = require('web3');
import { Transaction, BlockHeader } from 'web3/eth/types';
import { Provider, WebsocketProvider } from 'web3/providers';

export default class Connector {
    public web3: Web3 = new Web3(null);
    private txListeners: ((tx: Transaction) => void)[] = [];

    connect (makeProvider: () => Provider) {
        const ping = () => this.web3.eth.getBlockNumber();
        const blockHandler = (blockHash: string) => {
            this.web3.eth.getBlockTransactionCount(blockHash)
            .then(count => {
                const seqs = r.range(0, count);
                Promise.all(seqs.map(seq => this.web3.eth.getTransactionFromBlock(blockHash as any, seq)))
                .then(txs => {
                    txs.forEach(tx => this.txListeners.forEach(l => l(tx)));
                });
            });
        }
    
        this.web3.setProvider(makeProvider());

        let t: NodeJS.Timer = null;
        (this.web3.currentProvider as WebsocketProvider).on('connect', () => {
            t = setInterval(ping, 10000);
            // 重新連接就要重新註冊監聽事件
            this.web3.eth.subscribe('newBlockHeaders', (error, data) => {
                if (error) {
                    throw error;
                }
                //todo: 從上一次處理完的 block 處繼續
                const header: BlockHeader = data as any;
                blockHandler(header.hash);
            });
        });
    
        (this.web3.currentProvider as WebsocketProvider).on('end', () => {
            if (t === null) {
                setTimeout(() => this.connect(makeProvider), 5000);
            } else {
                clearInterval(t);
                this.connect(makeProvider);
            }
        });
    }

    onNewTransaction (cb: (tx: Transaction) => void) {
        this.txListeners.push(cb);
    }
}
