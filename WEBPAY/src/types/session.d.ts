// types/session.d.ts
import "express-session";

export interface OSessionData {
  id: string;
  username?: string;
  principal?: string;
  roles?: string[];
}

declare module "express-session" {
  interface SessionData {
    admin?: OSessionData;
    merchant?: OSessionData;
  }
}
