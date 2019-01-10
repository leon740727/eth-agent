export default class <T> {
    private jobs: Promise<any> = Promise.resolve(null);
    
    push (job: () => Promise<any>) {
        this.jobs = this.jobs.then(_ => job());
    }
}
