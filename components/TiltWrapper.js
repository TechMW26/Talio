'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

const springConfig = {
  damping: 30,
  stiffness: 100,
  mass: 2,
};

export default function TiltWrapper({
  children,
  rotateAmplitude = 2,   // subtle like your example
  scaleOnHover = 1,      // smooth zoom
}) {
  const ref = useRef(null);

  const rotateX = useSpring(0, springConfig);
  const rotateY = useSpring(0, springConfig);
  const scale = useSpring(1, springConfig);

  function handleMouseMove(e) {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;

    const rotationX = (offsetY / (rect.height / 2)) * -rotateAmplitude;
    const rotationY = (offsetX / (rect.width / 2)) * rotateAmplitude;

    rotateX.set(rotationX);
    rotateY.set(rotationY);
  }

  function handleMouseEnter() {
    scale.set(scaleOnHover);
  }

  function handleMouseLeave() {
    rotateX.set(0);
    rotateY.set(0);
    scale.set(1);
  }

  return (
    <div
      ref={ref}
      className="w-full h-full"
      style={{ perspective: 600 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        style={{
          rotateX,
          rotateY,
          scale,
          transformStyle: 'preserve-3d',
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
