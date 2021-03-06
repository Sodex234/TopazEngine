import logger from "./logger";
import read from "read-data";
import app from "./App";

export default class RequestManager {
    constructor(io) {
        this.io = io;

        this.reqStorage = {};
    }

    loadRequests() {
        // Load from file
        this.requests = read.sync("config/requests.json").data;

        this.requests.forEach(req => {
            this.registerRequest(req);
        });

        // Register the reqs listener.
        app.getInstance().app.post("/api/:wantedreq", (req, res) => {
            const wantedReq = req.params.wantedreq;

            // Check if this req exists
            if(this.reqStorage[wantedReq] === undefined) {
                res.json({
                    wantedRequest: wantedReq,
                    error: "That request is not defined."
                });

                return;
            }

            this.fireRequest(wantedReq, req.body).then(responseData => res.json(responseData));
        });

        this.io.on("connection", socket => {
            logger.log("A new client connected.");

            socket.on("MakeRequest", (dataObject) => {
                logger.log("Client sent a request over socket. The wanted request is: " + dataObject.wantedRequest);
                logger.log("Sent object to follow.");
                logger.log(dataObject);

                if(dataObject === undefined) {
                    dataObject = {}; // Stop erroring!
                }

                // Check if the request has a set unique id. It requires this for sockets so that we can respond with
                // the relevent data to the request since it's mostly async.
                if(dataObject.requestId === undefined) {
                    socket.emit("RequestResponse", {
                        error: "No RequestId was set. This is required for sockets."
                    });

                    return;
                }

                // Check if this req exists
                if(this.reqStorage[dataObject.wantedRequest] === undefined) {
                    socket.emit("RequestResponse", {
                        requestId: dataObject.requestId,
                        wantedRequest: dataObject.wantedRequest,
                        isTest: dataObject.isTest === undefined ? false : dataObject.isTest,
                        error: "That request is not defined."
                    });
                } else {
                    this.fireRequest(dataObject.wantedRequest, dataObject.body, {
                        requestId: dataObject.requestId,
                        isTest: dataObject.isTest === undefined ? false : dataObject.isTest
                    }).then(responseData => socket.emit("RequestResponse", responseData));
                }
            });
        });
    }

    registerRequest(reqFile) {
        logger.log("Adding request " + reqFile + ".");
        
        this.reqStorage[reqFile] = new (require("./requests/" + reqFile)).default();
    }

    // Runs a request and checks headers.
    async fireRequest(wantedRequest, data, baseObject = {}) {
        let wantedReq = this.reqStorage[wantedRequest];

        baseObject.wantedRequest = wantedRequest;

        // Check the headers in data.
        let errors = [];
        Object.keys(wantedReq.headerData).forEach(header => {
            if(data[header] === undefined && wantedReq.headerData[header].critical) {
                // This header has not been set.
                errors.push("Header " + header + " was not set. This header is " + wantedReq.headerData[header].description);
            } else if (data[header] === undefined) {
                // Push the default value
                data[header] = wantedReq.headerData[header].fallbackValue();
            }
        });

        baseObject.error = errors.length > 0;
        baseObject.errors = errors;
        baseObject.body = errors.length > 0 ? {} : await wantedReq.getResponse(data);

        return baseObject;
    }
}
