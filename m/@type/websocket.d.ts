declare module "websocket" {
    class w3cwebsocket {
        constructor (url: string, subprotocol: string);
        send (message: string);
        close ();
        
        onopen (): void;
        onmessage (message: {data: string}): void;
        onerror (): void;
    }
}
