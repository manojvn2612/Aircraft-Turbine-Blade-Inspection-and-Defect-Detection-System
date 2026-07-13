import { Camera, Check } from "lucide-react"
import { Button } from "./ui/button"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog"
import { useEffect, useRef, useState } from "react";
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

interface SocketData {
  img: string
  id: number
  name: string
}

interface CameraDialogProps {
  socketData: SocketData
}

const CameraDialog = ({socketData} : CameraDialogProps) => {
  // let ws: WebSocket | null = null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  // useEffect(() => {
  //   // Initialize WebSocket connection
  //   ws = new WebSocket("ws://localhost:8765");

  //   ws.onopen = () => {
  //   console.log("WebSocket connected");
  // };

  //   ws.onmessage = (event) => {
  //     // Handle received messages
  //     const imgdata = event.data;
  //     renderImage(imgdata);
  //     // Assuming the message contains image data, decode/process it and render on canvas
     
  // };

  //   ws.onclose = () => {
  //   console.log("WebSocket disconnected");
  // };

  //   // Clean-up function to close the WebSocket connection when the component unmounts
  // return () => {
  //     if (ws) {
  //       ws.close();
  //     }
  // };
 
  // }, []); // Empty dependency array ensures this effect runs only once when the component mounts

  const renderImage = (imageData: any) => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        const image = new Image();
        image.onload = () => {
          canvasRef.current?.getContext("2d")?.drawImage(image, 0, 0, canvasRef.current.width, canvasRef.current.height);
        };
        image.src = URL.createObjectURL(new Blob([imageData], { type: "image/jpeg" }));
      }
    }
  };
  
  // const clickPhoto = async () => {
  //   setLoading(true);
  //   try {
  //     // Make a GET request to the Flask server to capture the photo
  //     const res = await axios.get('http://127.0.0.1:5000/predict');
  //     console.log(res.data);
  //     console.log(res.data.predicted_image);

  //     const src = "data:image/jpeg;base64," + res.data.predicted_image;
  //     if (ws) {
  //       ws.close();
  //     }
  //     navigate(
  //       "/results", 
  //       { state: { imgSrc: src, imgClasses: res.data.classes } }
  //     );
  //   } catch (error) {
  //     console.error('Error capturing photo from camera:', error);
  //   }
  //   setLoading(false);
  // };
  const clickPhoto = async () => {
    if (!socketData.img) {
      console.error("No image available");
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();

      // Convert base64 to Blob
      const response = await fetch(socketData.img);
      const blob = await response.blob();

      formData.append("image", blob, "upload.jpg");

      const res = await axios.post(
        "http://127.0.0.1:5000/predict",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        }
      );

      const src = "data:image/png;base64," + res.data.predicted_image;

      navigate("/results", {
        state: {
          imgSrc: src,
          imgClasses: res.data.classes
        }
      });

    } catch (error) {
      console.error("Prediction error:", error);
    }

    setLoading(false);
  };

  return (
    
    <DialogContent className="min-w-[70vw] h-fit border-2 border-background rounded-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center justify-center text-3xl font-bold text-slate-800">Take a Photo</DialogTitle>
        <DialogDescription>
          <div className="flex flex-col pt-8 gap-4">
            {socketData.img && (
                <img
                  src={socketData.img}
                  className="w-full h-auto rounded-xl"
                  alt="Uploaded Preview"
                />
              )}
            <p>{socketData.name}</p>
            <div className="w-full flex items-center justify-center gap-4">
              <Button variant='default' size='default' className="flex gap-2  text-white font-semibold">
                <Camera className="w-5" />
                Take Photo
              </Button>
              <Button onClick={clickPhoto} variant='default' size='default' className="flex gap-2 bg-secondary hover:bg-secondary-foreground text-white font-semibold">
                <Check className="w-5" />
                Submit Photo
              </Button>
            </div>
          </div>
        </DialogDescription>
      </DialogHeader>
    </DialogContent>
  )
}

export default CameraDialog
