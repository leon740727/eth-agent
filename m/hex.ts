export default class Hex extends String {
    
    private _ = null;                   // 讓 string 不能直接當成 Hex 用

    constructor (str: string) {
        super(str.replace(/^0x/, '').toLowerCase());
        if (this.toString().match(/[^abcdef0123456789]/) !== null) {
            throw new Error(`wrong Hex value: ${str}`);
        }
    }

    toString () {
        return this.valueOf();
    }

    static of (str: string) {
        return new Hex(str);
    }

    static formalize (str: string): string {
        return Hex.of(str).toString();
    }
}
