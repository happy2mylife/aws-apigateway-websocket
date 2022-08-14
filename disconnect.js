const AWS = require("aws-sdk");
const documentClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  const { body } = event;
  const { connectionId, apiId, stage } = event.requestContext;
  const endpoint = `https://${apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/${stage}`;

  await leaveRoom(connectionId);

  await deleteClientId(connectionId);

  const response = {
    statusCode: 200,
  };
  return response;
};

const deleteClientId = async (connectionId) => {
  const param = {
    TableName: process.env.CONNECTING_CLIENT_TABLE,
    Key: {
      client_id: connectionId,
    },
  };

  console.log("connectionId: ", connectionId);

  console.log("before documentClient.delete");
  // ログを見ると2回putが呼ばれている
  await documentClient
    .delete(param)
    .promise()
    .then(() => {
      console.log("delete");
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  console.log("after documentClient.delete");
};

/**
 * クライアントをルームから削除
 * @param {*} clientId
 */
async function leaveRoom(connectionId) {
  const params = {
    TableName: process.env.CHAT_ROOM,
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

async function removeFromRoom(room, connectionId) {
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
      const deleteParam = {
        TableName: process.env.CHAT_ROOM,
        Key: { room_name: room["room_name"] },
      };
      await documentClient.delete(deleteParam).promise();
      return;
    } catch (err) {
      return;
    }
  }

  // 該当ルームよりクライアントを除外
  const params = {
    TableName: process.env.CHAT_ROOM,
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
