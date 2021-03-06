var MMTPayloadHeader = require('./mmt-payload-header.js');
var DataUnitType = require('./du-type');
var cnt2 = 0

//MPU, MFU and Data Unit...

class payloadizer {
    /**
     * 
     * @param {*} isTimed : timed(true) or non-timed(false)
     * @param {*} useMmtp : mmtp(true) or gfd(false)
     * @param {*} duFragmentation : fragmentation(true) or not(false)
     *                               du 하나를 자르는 것
     */
    constructor (isTimed, useMmtp, duFragmentation, payloadType) {
        this.storedDUCnt_ = 0;
        this.duList_ = [];
        this.duListIterator_ = 0;
        this.duListLimit_ = 30;
        this.duMaxLength_ = Math.pow(2,16)-1;
        this.payloadList_ = [];
        this.payloadListIterator_ = 0;
        this.payloadListLimit_ = 100;

        this.isTimed = isTimed;
        this.useMmtp = useMmtp;
        this.duFragmentation = duFragmentation;
        this.duAggregationCnt = 1;
        this.payloadType = payloadType;
    }

    payloadize () { 
        let ret = false;
        let du = null;

        let payload = null;
        let payloadIterator = 0;
        let payloadHeader = new MMTPayloadHeader();
        let payloadHeaderObj = null;
        let payloadizeDUs = [];
        let i = 0;
        let j = 0;

        if (this.duList_.length < this.duListIterator_ || this.duList_.length === 0) {
            console.log("No Data unit")
            return ret;
        }
        
        // Common payload header un-related du fragmentation
        payloadHeader.type = this.payloadType;
        if (payloadHeader.type === 0x00) { //MPU
            payloadHeader.randomAccessPointFlag = 0x01; // I-Frame 존재
        }
        else if (payloadHeader.type === 0x01) { // MPU Fragment
            payloadHeader.randomAccessPointFlag = 0x00; // I-Frame을 안다면 0x01
        }
        else { // signaling msg, repaire symbol, gfd mode, and others
            payloadHeader.randomAccessPointFlag = 0x00;
        }

        if (this.duFragmentation === false) {
            let numOfPayloadizeDu = 0;
            let du_datas = [];

            // getting data units (number of data unit is this.duAggregationCnt)
            for (i = 0; i < this.duAggregationCnt && this.duList_.length > this.duListIterator_; i++) {
                payloadizeDUs.push(this.duList_[this.duListIterator_]);
                this.duListIterator_++;
            }
            numOfPayloadizeDu = payloadizeDUs.length;
            if (numOfPayloadizeDu === 0) {
                console.log("No Data unit");
                return ret;
            }
            console.log("numOfPayloadizeDu: " + numOfPayloadizeDu);

            // Common payload header un-related du length
            payloadHeader.mpuSequenceNumberFlag = 0x01;
            payloadHeader.mpuSequenceNumber = payloadizeDUs[0].mpuSeqNum;
            payloadHeader.fragmentationIndicator = 0x00;
            payloadHeader.aggregationFlag = 0x01;
            payloadHeader.fragmentCounter = 0x00;
                        
            for (i = 0; i < numOfPayloadizeDu; i++) {
                du = payloadizeDUs[i];

                let beginPoint = 0;
                let endPoint = this.duMaxLength_;
                if (du.length < this.duMaxLength_) {
                    endPoint = du.length;
                }
                while (beginPoint < du.length) {
                    let fragDULength = endPoint - beginPoint;
                    let fragDU = Buffer.allocUnsafe(fragDULength).fill(0x00);
                    du.data.copy(fragDU, 0, beginPoint, endPoint);
                    du_datas.push(fragDU);
                    //console.log("DU pushed: " + fragDU);

                    beginPoint += this.duMaxLength_;
                    endPoint += this.duMaxLength_;
                    if (endPoint > du.length) {
                        endPoint = du.length;
                    }
                }
            }

            let totalFragDULength = 0;
            for (j = 0; j < du_datas.length; j++) {
                totalFragDULength += (du_datas[j].length + 2); // 2 is du lengt space (2 bytes)
            }

            payloadIterator = 0;
            payloadHeaderObj = this.setPayloadHeader(payloadHeader);
            payload = Buffer.allocUnsafe(totalFragDULength + payloadHeaderObj.len).fill(0x00);
            payloadHeaderObj.buf.copy(payload, payloadIterator, 0, payloadHeaderObj.len);
            payloadIterator += payloadHeaderObj.len;
            console.log("du_datas.length: " + du_datas.length);
            for (j = 0; j < du_datas.length; j++) {
                //console.log("Index out of range? " + du.length + " - " + payloadIterator + " - " + payload.length); //du.length is less than 65536
                payload.writeUIntBE(du_datas[j].length, payloadIterator, 2);
                payloadIterator += 2;
                //console.log("du.data - " +du.data);
                du_datas[j].copy(payload, payloadIterator, 0, du_datas[j].length);
                payloadIterator += du_datas[j].length;
            }                    

            this.payloadList_.push({
                payload : payload,
                length : payloadIterator
            });
        }
        else {
            du = this.duList_[this.duListIterator_];
            // Common payload header un-related du length
            payloadHeader.mpuSequenceNumberFlag = 0x01;
            payloadHeader.mpuSequenceNumber = du.mpuSeqNum;

            if (du.length <= this.duMaxLength_) { // contain 1 du_length, du_header and du_payload
                payloadHeader.fragmentationIndicator = 0x00;
                payloadHeader.aggregationFlag = 0x01;
                payloadHeader.fragmentCounter = 0x00;

                payloadIterator = 0;
                payloadHeaderObj = this.setPayloadHeader(payloadHeader);
                payload = Buffer.allocUnsafe(du.length + 2 + payloadHeaderObj.len).fill(0x00);
                payloadHeaderObj.buf.copy(payload, payloadIterator, 0, payloadHeaderObj.len);
                payloadIterator += payloadHeaderObj.len;
                //console.log("Index out of range? " + du.length + " - " + payloadIterator + " - " + payload.length); //du.length is less than 65536
                payload.writeUIntBE(du.length, payloadIterator, 2);
                payloadIterator += 2;
                //console.log("du.data - " +du.data);
                du.data.copy(payload, payloadIterator, 0, du.data.length);
                payloadIterator += du.data.length;

                this.payloadList_.push({
                    payload : payload,
                    length : payloadIterator
                });
            }
            else {
                let beginPoint = 0;
                let endPoint = this.duMaxLength_;

                payloadHeader.aggregationFlag = 0x00;
                payloadHeader.fragmentCounter = du.length / this.duMaxLength_ + 1;

                while (beginPoint > du.length) {
                    if (beginPoint === 0) {
                        payloadHeader.fragmentationIndicator = 0x01;
                    }
                    else if (endPoint === du.length) {
                        payloadHeader.fragmentationIndicator = 0x03;
                    }
                    else {
                        payloadHeader.fragmentationIndicator = 0x02;
                    }

                    payloadIterator = 0;
                    payloadHeaderObj = this.setPayloadHeader(payloadHeader);
                    payload = Buffer.allocUnsafe(endPoint - beginPoint + 2 + payloadHeaderObj.len).fill(0x00);
                    payloadHeaderObj.buf.copy(payload, payloadIterator, 0, payloadHeaderObj.len);
                    payloadIterator += payloadHeaderObj.len;
                    //console.log("Index out of range? " + du.length + " - " + payloadIterator + " - " + payload.length); //du.length is less than 65536
                    payload.writeUIntBE(endPoint - beginPoint, payloadIterator, 2);
                    payloadIterator += 2;
                    //console.log("du.data - " +du.data);
                    du.data.copy(payload, payloadIterator, beginPoint, endPoint);
                    payloadIterator += (endPoint - beginPoint);

                    //console.log("Push payload: ");
                    //console.log(payload);
                    this.payloadList_.push({
                        payload : payload,
                        length : payloadIterator
                    });

                    beginPoint = endPoint + 1;
                    endPoint += this.duMaxLength_;
                    if (endPoint > du.length) {
                        endPoint = du.length;
                    }
                }
            }

            this.duListIterator_++;
        }

        if (this.duListIterator_ > this.duListLimit_) {
            this.duList_.splice(0, this.duListIterator_);
            this.duListIterator_ = 0;
        }
        this.storedDUCnt_--;

        return ret;
    }

    setPayloadHeader (payloadHeader) {
        let payloadHeaderBuf = null;
        let payloadHeaderLen = payloadHeader.typeBytes + payloadHeader.fragmentationIndicatorBits + payloadHeader.aggregationFlagBits + payloadHeader.randomAccessPointFlagBits + payloadHeader.mpuSequenceNumberFlagBits + payloadHeader.S_Bits + payloadHeader.mpuSequenceNumberBytes + payloadHeader.fragmentCounterBytes;
        let payloadIter = 0;
        payloadHeaderBuf = Buffer.allocUnsafe(payloadHeaderLen).fill(0x00);
        
        payloadHeaderBuf.writeUIntBE(payloadHeader.type, payloadIter, payloadHeader.typeBytes);
        payloadIter += payloadHeader.typeBytes;
        if (cnt2 === 0) {
            console.log("type: " + payloadHeaderBuf + " - " + payloadHeader.type);
        }

        let flagsBufferLen = payloadHeader.fragmentationIndicatorBits + payloadHeader.aggregationFlagBits + payloadHeader.randomAccessPointFlagBits + payloadHeader.mpuSequenceNumberFlagBits + payloadHeader.S_Bits;
        let flagsBufferShift = flagsBufferLen - payloadHeader.fragmentationIndicatorBits;
        flagsBufferLen /= 8; // To Bytes
        let flagsBuffer = 0x00;
        flagsBuffer |= (payloadHeader.fragmentationIndicator << flagsBufferShift);
        if (cnt2 === 0) {
            console.log("fragmentationIndicator: " + flagsBuffer + " - " + payloadHeader.fragmentationIndicator + " - " + flagsBufferShift);
        }
        flagsBufferShift -= payloadHeader.aggregationFlagBits;
        flagsBuffer |= (payloadHeader.aggregationFlag << flagsBufferShift);
        if (cnt2 === 0) {
            console.log("aggregationFlag: " + flagsBuffer + " - " + payloadHeader.aggregationFlag + " - " + flagsBufferShift);
        }
        flagsBufferShift -= payloadHeader.randomAccessPointFlagBits;
        flagsBuffer |= (payloadHeader.randomAccessPointFlag << flagsBufferShift);
        if (cnt2 === 0) {
            console.log("randomAccessPointFlag: " + flagsBuffer + " - " + payloadHeader.randomAccessPointFlag + " - " + flagsBufferShift);
        }
        flagsBufferShift -= payloadHeader.mpuSequenceNumberFlagBits;
        flagsBuffer |= (payloadHeader.mpuSequenceNumberFlag << flagsBufferShift);
        if (cnt2 === 0) {
            console.log("mpuSequenceNumberFlag: " + flagsBuffer + " - " + payloadHeader.mpuSequenceNumberFlag + " - " + flagsBufferShift);
        }
        flagsBufferShift -= payloadHeader.S_Bits;
        flagsBuffer |= (payloadHeader.S << flagsBufferShift);
        if (cnt2 === 0) {
            console.log("S: " + flagsBuffer + " - " + payloadHeader.S + " - " + flagsBufferShift);
        }
        payloadHeaderBuf.writeUIntBE(flagsBuffer, payloadIter, flagsBufferLen);
        payloadIter += flagsBufferLen;
        if (cnt2 === 0) {
            console.log("flagsBuffer: " + payloadHeaderBuf + " - " + flagsBuffer);
        }

        if (payloadHeader.mpuSequenceNumberFlag) {
            payloadHeaderBuf.writeUIntBE(payloadHeader.mpuSequenceNumber, payloadIter, payloadHeader.mpuSequenceNumberBytes);
            payloadIter += payloadHeader.mpuSequenceNumberBytes;
            if (cnt2 === 0) {
                console.log("mpuSequenceNumber: " + payloadHeaderBuf + " - " + payloadHeader.mpuSequenceNumber);
            }
        }

        payloadHeaderBuf.writeUIntBE(payloadHeader.fragmentCounter, payloadIter, payloadHeader.fragmentCounterBytes);
        payloadIter += payloadHeader.fragmentCounterBytes;
        if (cnt2 === 0) {
            console.log("fragmentCounter: " + payloadHeaderBuf + " - " + payloadHeader.fragmentCounter);
        }
        cnt2++;

        return {buf: payloadHeaderBuf, len:payloadIter};
    }
/*
    makeMFUHeader (mfuHeader) {
        let header = null;
        let headerIter = 0;

        let fragmentedMPUHeader = Buffer.allocUnsafe(1).fill(((0x00 | mfuHeader.fragmentType) << 1) | (0x00 | mfuHeader.Timed));
        if (mfuHeader.Timed === 0x00) { // timed media
            let seqNumBuf = Buffer.allocUnsafe(4).fill(mfuHeader.movieFragSeqNum);
            let sampleNumBuf = Buffer.allocUnsafe(4).fill(mfuHeader.sampleNum);
            let offsetBuf = Buffer.allocUnsafe(2).fill(mfuHeader.timedMediaOffset);
            let priorityBuf = Buffer.allocUnsafe(1).fill(0x00 | mfuHeader.timedMediaPriority);
            let depCntBuf = Buffer.allocUnsafe(1).fill(0x00 | mfuHeader.timedMediaDepCounter);

            header = Buffer.allocUnsafe(13).fill(0x00);
            fragmentedMPUHeader.copy(header, headerIter, 0, 1);
            headerIter += 1;
            seqNumBuf.copy(header, headerIter, 0, 4);
            headerIter += 4;
            sampleNumBuf.copy(header, headerIter, 0, 4);
            headerIter += 4;
            offsetBuf.copy(header, headerIter, 0, 2);
            headerIter += 2;
            priorityBuf.copy(header, headerIter, 0, 1);
            headerIter += 1;
            depCntBuf.copy(header, headerIter, 0, 1);
            headerIter += 1;
        }
        else if (mfuHeader.Timed === 0x01) { // non-timed media
            let itemIdBuf = Buffer.allocUnsafe(4).fill(mfuHeader.nonTimedMediaItemID);
            header = Buffer.allocUnsafe(5).fill(0x00);
            fragmentedMPUHeader.copy(header, headerIter, 0, 1);
            headerIter += 1;
            itemIdBuf.copy(header, headerIter, 0, 4);
            headerIter += 4;
        }

        return header;
    }*/

    /**
     * 
     * @param {*} type : require('./du-type');
     * @param {*} du : MPU / Fragmented MPU / Singnaling message / repair symbol / Generic object
     */
    addDataUnit (type, du, mpuSeqNum) {
        if (type !== null && du !== null && du !== undefined && du.length !== undefined) {
            this.duList_.push({
                type: type,
                mpuSeqNum: mpuSeqNum,
                data : du,
                length : du.length
            });
            this.storedDUcnt_ ++;
            return true;
        }
        else {
            console.log("DU Error!!!")
        }
        return false;
    }

    get payload () {
        if (this.payloadListIterator_ < this.payloadList_.length) {
            let payload = this.payloadList_[this.payloadListIterator_];
            this.payloadListIterator_++;
            if (this.payloadListIterator_ > this.payloadListLimit_) {
                this.payloadList_.splice(0, this.payloadListIterator_);
                this.payloadListIterator_ = 0;
            }
            console.log("return payload(" + this.payloadListIterator_ + "): ");
            console.log(payload.payload);
            return payload;
        }
        else {
            return null;
        }
    }
}
module.exports = payloadizer;