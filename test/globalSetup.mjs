import nock from "nock";

export function globalSetup() {
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");
}

export function globalTeardown() {
  nock.enableNetConnect();
}
