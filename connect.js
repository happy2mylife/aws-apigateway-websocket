const AWS = require("aws-sdk");
const documentClient = new AWS.DynamoDB.DocumentClient();

const MessageType = {
  JoinRoom: 1,
  LeaveRoom: 2,
  SendMessage: 3,
  SendImage: 4,
  Connected: 5,
  ListMember: 6,
  SendURL: 7,
};

/**
 * Lambda invokeをしようとしたら以下のエラー
 * ユーザーにAWSLambdaRoleを追加
 * 
 2022-08-14T09:23:02.495Z	07a9bce9-cb13-445c-96e3-37ee51e1b7b9	INFO	err:  AccessDeniedException: User: arn:aws:sts::520196876033:assumed-role/kinoko-sample-chat-connect-role-53mhcevq/kinoko-sample-chat-connect is not authorized to perform: lambda:InvokeFunction on resource: arn:aws:lambda:ap-northeast-1:520196876033:function:kinoko-sample-chat-on-message because no identity-based policy allows the lambda:InvokeFunction actio
 * 

 上記でもNG。AWSLambdaRoleがInvokeのみ許可なので、同期を許可していない。
 InvocationType: "Event",　のように非同期にしたところ通った！
 */

// connect内で自身のclientIdにpostはできないっぽい
exports.handler = async (event) => {
  const { connectionId, apiId, stage } = event.requestContext;

  // Dynamoに格納
  await putClientId(connectionId);

  const response = {
    statusCode: 200,
  };

  event.body = JSON.stringify({
    type: MessageType.Connected,
  });

  const lambda = new AWS.Lambda({ apiVersion: "2015-03-31" });
  const params = {
    FunctionName: "kinoko-sample-chat-on-message", // Lambda 関数の ARN を指定
    InvocationType: "Event",
    Payload: JSON.stringify(event),
  };
  console.log(params);
  await lambda
    .invoke(params)
    .promise()
    .then(() => {
      console.log("ok! lambda.invoke");
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  return response;
};

const putClientId = async (connectionId) => {
  const param = {
    TableName: process.env.CONNECTING_CLIENT_TABLE,
    Item: {
      client_id: connectionId,
    },
  };
  console.log("connectionId: ", connectionId);

  console.log("before documentClient.put");

  await documentClient
    .put(param)
    .promise()
    .then(() => {
      console.log("put");
    })
    .catch((err) => {
      console.log("err: ", err);
    });

  console.log("after documentClient.put");
};
