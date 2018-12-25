"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Web3 = require("web3");
class Connector {
    constructor() {
        this.web3 = new Web3(null);
        this.blockListeners = [];
    }
    connect(makeProvider) {
        const ping = () => this.web3.eth.getBlockNumber();
        this.web3.setProvider(makeProvider());
        let t = null;
        this.web3.currentProvider.on('connect', () => {
            t = setInterval(ping, 10000);
            // 重新連接就要重新註冊監聽事件
            this.web3.eth.subscribe('newBlockHeaders', (error, data) => {
                if (error) {
                    throw error;
                }
                const header = data;
                this.blockListeners.forEach(l => l(header));
            });
        });
        this.web3.currentProvider.on('end', () => {
            if (t === null) {
                setTimeout(() => this.connect(makeProvider), 5000);
            }
            else {
                clearInterval(t);
                this.connect(makeProvider);
            }
        });
    }
    onNewBlock(listener) {
        this.blockListeners.push(listener);
    }
}
exports.default = Connector;
