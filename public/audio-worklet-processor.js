// public/audio-worklet-processor.js
class AudioWorkletStreamProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.port.onmessage = (event) => {
        // Message from main thread
      };
    }
  
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input.length > 0) {
        const inputChannelData = input[0];
        this.port.postMessage(inputChannelData.buffer, [inputChannelData.buffer]);
      }
      return true;
    }
  }
  registerProcessor('audio-worklet-stream-processor', AudioWorkletStreamProcessor);