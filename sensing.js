//mic, accelr, light, camera

import React, { useState, useRef, useEffect } from 'react';

function App() {
    const [micStatus, setMicStatus] = useState('Idle');
    const micStreamRef = useRef(null);
    const audioRef = useRef([]);
    const [audioStatus, setAudioStatus] = useState(null);

    const [accel, setAccel] = useState(null);
    const accelSensorRef = useRef(null);

    const [light, setLight] = useState(null);

    const [cameraStream, setCameraStream] = useState(null);
    const cameraStreamRef = useRef(null);
    const videoRef = useRef(null);

    const [error, setError] = useState('');


    const [isMicActive, setIsMicActive] = useState(false);
    const [isAccelActive, setIsAccelActive] = useState(false);
    const [isLightActive, setIsLightActive] = useState(false);
    const [isCameraActive, setIsCameraActive] = useState(false);

    // Mic
    const toggleMic = async () => {
        if (isMicActive) 
        {
            if (micStreamRef.current) 
            {
                micStreamRef.current.getTracks().forEach(track => track.stop());
                micStreamRef.current = null;
            }
            setMicStatus('Idle');
            setIsMicActive(false);
            return;
        } 
        try 
        {
            setAudioStatus(null);
            setMicStatus('Requesting');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStreamRef.current = stream;
            setMicStatus('Listening');
            setIsMicActive(true);
            setError('');

            audioRef.current = [];
            
        }
        catch (err) 
        {
            setMicStatus('Error');
            setError('Error accessing microphone');
            setIsMicActive(false);
        }
    };

    // Accelerometer
    const toggleAccel = async () => {
    if (isAccelActive) {
        if (accelSensorRef.current) {
            accelSensorRef.current.stop();
            accelSensorRef.current = null;
        }
        setIsAccelActive('Idle');
        setAccel(null);
        // return;
    } else {
        try {
            setError('');
            const permissionStatus = await navigator.permissions.query({ name: 'accelerometer' });
            if (permissionStatus.state === 'denied') {
                setError('加速度センサーへのアクセスが明示的にブロックされています。');
                return;
            }

            const accelerometer = new Accelerometer({ frequency: 10 });

            accelerometer.onreading = () => {
                // stateを更新してUIに表示
                const accelData = {
                    x: accelerometer.x.toFixed(2),
                    y: accelerometer.y.toFixed(2),
                    z: accelerometer.z.toFixed(2),
                };
                setAccel(accelData);
                //出力結果
                console.log(accelData)            
            };

            accelerometer.start();
            accelSensorRef.current = accelerometer;
            setIsAccelActive(true);
        } catch (err) {
            setError(`加速度センサーが利用できません: ${err.name} (HTTPS環境または対応ブラウザが必要です)`);
            setIsAccelActive(false);
        }
    }
    };

    // Light
    const toggleLight = async () => {

    };

    // Camera
    const toggleCamera = async () => {

    };

    return (
        <div>
        
        </div>
    );
}

export default App;