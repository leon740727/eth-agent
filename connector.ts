import Web3 = require('web3');
import { BlockHeader } from 'web3/eth/types';
import { Provider, WebsocketProvider } from 'web3/providers';
import { EventListener } from './m/utils';

export default class Connector {
    public web3: Web3 = new Web3(null);
    private blockListeners: EventListener<BlockHeader>[] = [];

    connect (makeProvider: () => Provider) {
        const ping = () => this.web3.eth.getBlockNumber();
    
        this.web3.setProvider(makeProvider());

        let t: NodeJS.Timer = null;
        (this.web3.currentProvider as WebsocketProvider).on('connect', () => {
            t = setInterval(ping, 10000);
            // 重新連接就要重新註冊監聽事件
            this.web3.eth.subscribe('newBlockHeaders', (error, data) => {
                if (error) {
                    throw error;
                }
                const header: BlockHeader = data as any;
                this.blockListeners.forEach(l => l(header));
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

    onNewBlock (listener: EventListener<BlockHeader>) {
        this.blockListeners.push(listener);
    }
}
