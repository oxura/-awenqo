declare module "supertest" {
  import type { Application } from "express";
  
  interface Test extends Promise<Response> {
    get(url: string): Test;
    post(url: string): Test;
    put(url: string): Test;
    delete(url: string): Test;
    patch(url: string): Test;
    send(data: unknown): Test;
    set(header: string, value: string): Test;
    expect(status: number): Test;
  }
  
  interface SuperTest {
    get(url: string): Test;
    post(url: string): Test;
    put(url: string): Test;
    delete(url: string): Test;
    patch(url: string): Test;
  }
  
  interface Response {
    status: number;
    body: any;
    headers: Record<string, string>;
    text: string;
  }
  
  function supertest(app: Application | any): SuperTest;
  export = supertest;
}
