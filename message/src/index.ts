import * as AWS from "aws-sdk";
import { APIGatewayEvent } from "aws-lambda";

import { MessageType } from "./MessageType";
import { ClientRequest, OnConnectRequest, RoomResponse } from "./ClientRequest";
import { RoomTable } from "./RoomTable";
import { resolveModuleName } from "typescript";

const documentClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event: APIGatewayEvent) => {
  console.log(event);

  const message = event.body;
  if (!message) {
    return {
      statusCode: 301,
    };
  }

  const { connectionId, apiId, stage } = event.requestContext;
  const endpoint = createEndPoint(apiId, stage);
  const apiGateway = new AWS.ApiGatewayManagementApi({
    apiVersion: "2018-11-29",
    endpoint,
  });

  const json: ClientRequest = JSON.parse(message);

  switch (json.type) {
    case MessageType.Connected:
      const rooms = await getRooms();
      const onConnectionJson = JSON.parse(message);
      onConnectionJson.rooms = rooms;

      const connectedParams: AWS.ApiGatewayManagementApi.PostToConnectionRequest =
        {
          Data: JSON.stringify(onConnectionJson),
          ConnectionId: connectionId!,
        };

      await apiGateway.postToConnection(connectedParams).promise().then();

      break;

    case MessageType.JoinRoom:
      const joinRoomParams: AWS.ApiGatewayManagementApi.PostToConnectionRequest =
        {
          Data: message,
          ConnectionId: connectionId!,
        };

      // 当該クライアントをルームから削除
      leaveRoom(connectionId!);
      joinRoom(connectionId!, json);

      await apiGateway.postToConnection(joinRoomParams).promise().then();
      await notifyRoomNames(connectionId!, apiGateway, message);

      break;

    case MessageType.SendMessage:
    case MessageType.SendImage:
      const clientIds = await getClientsInSameRoom(json);
      const apiGatewayCall: any[] = [];
      const sendMessageParams: AWS.ApiGatewayManagementApi.PostToConnectionRequest =
        { Data: message, ConnectionId: "" };

      clientIds.forEach((id) => {
        console.log(id);
        sendMessageParams.ConnectionId = id;
        apiGatewayCall.push(
          apiGateway.postToConnection(sendMessageParams).promise()
        );
      });

      await Promise.all(apiGatewayCall);

      break;

    case MessageType.ListMember:
      const members = await getClientsInSameRoom(json);
      const membersJson = JSON.parse(message);
      membersJson.members = [];
      members.forEach((member) => {
        membersJson.members.push({
          name: member,
        });
      });

      const membersParams: AWS.ApiGatewayManagementApi.PostToConnectionRequest =
        {
          Data: JSON.stringify(membersJson),
          ConnectionId: connectionId!,
        };

      await apiGateway.postToConnection(membersParams).promise().then();
      break;
  }

  const response = {
    statusCode: 200,
  };
  return response;
};

/**
 * endpoint生成
 *
 * @param apiId
 * @param stage
 * @returns
 */
const createEndPoint = (apiId: string, stage: string) => {
  const endpoint = `https://${apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/${stage}`;

  return endpoint;
};

/**
 * 送信元クライアントと同じルームにいる参加者を取得
 * @returns
 */
const getClientsInSameRoom = async (json: ClientRequest): Promise<string[]> => {
  const params: AWS.DynamoDB.DocumentClient.QueryInput = {
    TableName: process.env.CHAT_ROOM!,
    KeyConditionExpression: "room_name = :roomName",
    ExpressionAttributeValues: {
      ":roomName": json.roomName,
    },
  };

  try {
    const result = await documentClient.query(params).promise();
    const rooms = result.Items;
    console.log("getClientsInSameRoom rooms: ", rooms);

    if (!rooms || rooms.length === 0) {
      return [];
    }
    return rooms[0]["client_ids"];
  } catch (err) {}

  return [];
};

const getRoomByRoomName = async (roomName: string): Promise<any> => {
  const params: AWS.DynamoDB.DocumentClient.QueryInput = {
    TableName: process.env.CHAT_ROOM!,
    KeyConditionExpression: "room_name = :roomName",
    ExpressionAttributeValues: {
      ":roomName": roomName,
    },
  };

  try {
    const result = await documentClient.query(params).promise();
    const rooms = result.Items;

    return rooms ? rooms[0] : null;
  } catch (err) {}

  return null;
};

async function getRooms(): Promise<RoomResponse[]> {
  const params: AWS.DynamoDB.DocumentClient.ScanInput = {
    TableName: process.env.CHAT_ROOM!,
  };
  const rooms: RoomResponse[] = [];

  try {
    const result = await documentClient.scan(params).promise();
    if (!result || !result.Items) {
      return [];
    }

    console.log(result.Items);
    result.Items.map((value) => value).forEach((value) => {
      const room: RoomResponse = {
        roomName: value["room_name"],
      };
      rooms.push(room);
    });
  } catch (err) {}
  return rooms;
}

/**
 * クライアントをルームから削除
 * @param {*} clientId
 */
async function leaveRoom(connectionId: string) {
  const params: AWS.DynamoDB.DocumentClient.ScanInput = {
    TableName: process.env.CHAT_ROOM!,
  };

  try {
    // TODO ルーム名がわかるから、ダイレクトにqueryすれば良い。
    const result = await documentClient.scan(params).promise();
    if (!result || !result.Items) {
      return;
    }

    console.log(result.Items);
    const rooms = result.Items;

    console.log("result.Items");
    console.log(rooms);

    for (let i = 0; i < rooms.length; i++) {
      console.log(rooms[i]["room_name"], ":", rooms[i]["client_ids"]);

      if (rooms[i]["client_ids"].indexOf(connectionId) != -1) {
        // 該当のルームにクライアントがいたら削除
        await removeFromRoom(rooms[i], connectionId);
        break;
      }
    }
  } catch (err) {}
}

async function removeFromRoom(room: any, connectionId: string): Promise<void> {
  const index = room["client_ids"].indexOf(connectionId);
  console.log("before removeFromRoom: length: ", room["client_ids"]);
  room["client_ids"].splice(index, 1);
  console.log(
    "after removeFromRoom: length: ",
    room["client_ids"],
    " : ",
    room.length
  );

  console.log("room name: ", room["room_name"]);

  if (room["client_ids"].length === 0) {
    console.log("room.length === 0!!!!");
    // 参加者がいなくなったらルームを削除
    try {
      const deleteParam: AWS.DynamoDB.DocumentClient.Delete = {
        TableName: process.env.CHAT_ROOM!,
        Key: { room_name: room["room_name"] },
      };
      await documentClient.delete(deleteParam).promise();
      return;
    } catch (err) {
      return;
    }
  }

  // 該当ルームよりクライアントを除外
  const params: AWS.DynamoDB.DocumentClient.Update = {
    TableName: process.env.CHAT_ROOM!,
    Key: { room_name: room["room_name"] },
    UpdateExpression: "set #room_in_clients=:clients",
    ExpressionAttributeNames: { "#room_in_clients": "client_ids" },
    ExpressionAttributeValues: {
      ":clients": room["client_ids"],
    },
  };

  try {
    await documentClient.update(params).promise();
  } catch (err) {}
}

/**
 * クライアントをルームに追加
 *
 * @param clientId
 * @param json
 */
async function joinRoom(clientId: string, json: ClientRequest): Promise<void> {
  const room = await getRoomByRoomName(json.roomName);
  if (room) {
    console.log("already joined room. ", room);
    console.log([...room["client_ids"], clientId]);
    // 既に該当のルームが存在している場合は、クライアントを追加
    const params: AWS.DynamoDB.DocumentClient.Update = {
      TableName: process.env.CHAT_ROOM!,
      Key: { room_name: json.roomName },
      UpdateExpression: "set #room_in_clients=:clients",
      ExpressionAttributeNames: { "#room_in_clients": "client_ids" },
      ExpressionAttributeValues: {
        ":clients": [...room["client_ids"], clientId],
      },
    };

    console.log("joinRoom: clientt_ids = ", room["client_ids"]);

    try {
      await documentClient.update(params).promise();
    } catch (err) {}
    return;
  }

  const params: AWS.DynamoDB.DocumentClient.PutItemInput = {
    TableName: process.env.CHAT_ROOM!,
    Item: {
      room_name: json.roomName,
      client_ids: [clientId],
    },
  };

  try {
    await documentClient.put(params).promise();
  } catch (err) {}
}

const getAllConnections = async (): Promise<string[]> => {
  const params: AWS.DynamoDB.DocumentClient.ScanInput = {
    TableName: process.env.CONNECTING_CLIENT_TABLE!,
  };
  const connections: string[] = [];

  try {
    const result = await documentClient.scan(params).promise();
    if (!result || !result.Items) {
      return [];
    }

    result.Items.map((value) => value).forEach((value) => {
      connections.push(value["client_id"]);
    });
  } catch (err) {}

  return connections;
};

const notifyRoomNames = async (
  ownerConnectionId: string,
  apiGateway: AWS.ApiGatewayManagementApi,
  message: any
): Promise<void> => {
  const allConnections: string[] = await getAllConnections();

  const connections = allConnections.filter(
    (connection) => connection != ownerConnectionId
  );

  const promises = connections.map((connection) =>
    apiGateway
      .postToConnection({
        ConnectionId: connection,
        Data: message,
      })
      .promise()
  );

  await Promise.all(promises);
};

const getConnectionsInRoom = async (roomName: string): Promise<string[]> => {
  const params: AWS.DynamoDB.DocumentClient.QueryInput = {
    TableName: process.env.CHAT_ROOM!,
    KeyConditionExpression: "room_name = :roomName",
    ExpressionAttributeValues: {
      ":roomName": roomName,
    },
  };

  try {
    const result = await documentClient.query(params).promise();
    const rooms = result.Items;

    if (!rooms || rooms.length === 0) {
      return [];
    }
    return rooms[0]["client_ids"];
  } catch (err) {}

  return [];
};
