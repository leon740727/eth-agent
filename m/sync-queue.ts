export default class <T> {
    private jobs: Promise<any> = Promise.resolve(null);
    
    push (job: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.jobs = this.jobs.then(_ => job().then(resolve));
        });
    }
}
