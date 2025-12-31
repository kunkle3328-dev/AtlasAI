import React, { useEffect, useRef } from 'react';

interface VoiceVisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({ isActive, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const draw = () => {
      time += 0.05;
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      if (!isActive) {
        // Idle line
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      // Active orb/waveform
      // Create a glowing gradient center
      const gradient = ctx.createRadialGradient(width/2, height/2, 10, width/2, height/2, 100);
      gradient.addColorStop(0, `rgba(99, 102, 241, ${0.2 + volume})`); // Indigo
      gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Draw Waveform
      ctx.beginPath();
      ctx.moveTo(0, centerY);

      const baseAmplitude = 20;
      const activeAmplitude = volume * 100;
      
      for (let x = 0; x < width; x++) {
        const sine1 = Math.sin(x * 0.03 + time * 2);
        const sine2 = Math.sin(x * 0.07 - time);
        const y = centerY + (sine1 + sine2) * (baseAmplitude + activeAmplitude * Math.sin(x/width * Math.PI)); 
        ctx.lineTo(x, y);
      }

      ctx.strokeStyle = `rgba(165, 180, 252, ${0.5 + volume * 0.5})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [isActive, volume]);

  return (
    <div className="w-full h-48 flex items-center justify-center">
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={200}
        className="w-full h-full max-w-2xl"
      />
    </div>
  );
};

export default VoiceVisualizer;
