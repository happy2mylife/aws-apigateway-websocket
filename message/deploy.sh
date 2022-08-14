rm -rf ./dist
npm run build
cp -f ./package.json ./package-lock.json ./dist
cd dist
npm install --production
zip -r ../message.zip ./