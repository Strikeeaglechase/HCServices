FROM node:20.5.0-alpine as libs-builder

RUN mkdir -p /home/node/app
WORKDIR /home/node/app

COPY VTOLLiveViewerCommon/ VTOLLiveViewerCommon/
COPY MicroserviceArch/ MicroserviceArch/
COPY storageService/ storageService/

WORKDIR /home/node/app/VTOLLiveViewerCommon
RUN npm install --include=dev && npx tsc

WORKDIR /home/node/app/MicroserviceArch/transformer
RUN npm install --include=dev && npx tsc

WORKDIR /home/node/app/MicroserviceArch/core
RUN npm install --include=dev && npx tsc

WORKDIR /home/node/app/MicroserviceArch/serviceLib
RUN rm -r /home/node/app/MicroserviceArch/serviceLib/src/serviceDefs/ && npm install --include=dev && npx tsc


FROM node:20.5.0-alpine

WORKDIR /home/node/app

COPY --from=libs-builder /home/node/app .

WORKDIR /home/node/app/storageService

RUN npm install --include=dev && npm run prepare && npm run build

ENV SERVICE_CONNECTOR_URL=ws://172.22.80.1:8005
ENV SERVICE_KEY=master_service_key
ENV API_PORT=8014
ENV DATA_PATH=../store/
ENV EXTERNAL_IP=127.0.1.1
ENV EXTERNAL_PORT=9014

EXPOSE 8014
EXPOSE 9014
WORKDIR /home/node/app/storageService/dist
CMD ["node", "index.js"]