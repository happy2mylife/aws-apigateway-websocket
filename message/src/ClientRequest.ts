import { MessageType } from "./MessageType";

export interface ClientRequest {
  name: string;
  type: MessageType;
  roomName: string;
  chatText: string;
}

export interface OnConnectRequest {
  type: MessageType;
  rooms: string[];
}

export interface RoomResponse {
  roomName: string;
}
