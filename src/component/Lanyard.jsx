'use client';
import { useEffect, useRef, useState } from 'react';
import { FaCamera } from 'react-icons/fa';
import './Lanyard.css';

export default function Lanyard({ employee, onImageClick, uploadingImage }) {
  const containerRef = useRef(null);
  const cardOuterRef = useRef(null);
  const cardSpinRef = useRef(null);
  const lanyardPathRef = useRef(null);
  const lanyardPathBorderRef = useRef(null);
  const lanyardLogosRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !cardOuterRef.current) return;

    const cardOuter = cardOuterRef.current;
    const cardSpin = cardSpinRef.current;
    const lanyardPath = lanyardPathRef.current;
    const lanyardPathBorder = lanyardPathBorderRef.current;
    const lanyardLogos = lanyardLogosRef.current;
    const container = containerRef.current;

    // Responsive card dimensions based on viewport width - increased sizes
    const isMobile = window.innerWidth <= 480;
    const isTablet = window.innerWidth <= 768 && window.innerWidth > 480;
    
    const CARD_W = isMobile ? 300 : isTablet ? 320 : 320;
    const CARD_H = isMobile ? 430 : isTablet ? 460 : 460;
    const CLIP_HEIGHT = 18;

    // Update card outer dimensions
    cardOuter.style.width = CARD_W + 'px';
    cardOuter.style.height = CARD_H + 'px';

    let anchor = {
      x: container.offsetWidth / 2,
      y: 0
    };

    function handleResize() {
      anchor.x = container.offsetWidth / 2;
    }
    window.addEventListener("resize", handleResize);

    // PHYSICS PARAMETERS - adjust rest position for larger card, moved higher
    const restPosY = isMobile ? 360 : isTablet ? 400 : 480;
    const restPos = { x: 0, y: restPosY };
    let pos = { x: 0, y: isMobile ? 220 : isTablet ? 240 : 280 };
    let vel = { x: 0, y: 0 };

    const kSpring = 200.35;
    const damping = 10.12;
    const gravity = 25;

    // Card flip state
    let isFlipped = false;

    // Drag tracking
    let dragging = false;
    let dragOffset = { x: 0, y: 0 };
    let dragVel = { x: 0, y: 0 };
    let lastDragTime = null;
    let lastDragPos = { x: 0, y: 0 };
    let dragStartPos = { x: 0, y: 0 };
    let wasDragged = false;

    // Pointer handlers
    const onPointerDown = (e) => {
      // Skip if clicking on camera button or its children
      if (e.target.closest('.avatar-camera-btn')) {
        return;
      }
      
      dragging = true;
      wasDragged = false;
      cardOuter.classList.add("dragging");
      cardOuter.setPointerCapture(e.pointerId);

      const rect = cardOuter.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      dragOffset.x = cx - e.clientX;
      dragOffset.y = cy - e.clientY;

      dragStartPos.x = e.clientX;
      dragStartPos.y = e.clientY;

      vel.x = 0;
      vel.y = 0;
      dragVel.x = 0;
      dragVel.y = 0;
      lastDragTime = performance.now();
      lastDragPos.x = pos.x;
      lastDragPos.y = pos.y;
    };

    const endDrag = (e) => {
      // Skip if clicking on camera button or its children
      if (e.target.closest('.avatar-camera-btn')) {
        return;
      }
      
      if (!dragging) return;
      dragging = false;
      cardOuter.classList.remove("dragging");
      try { cardOuter.releasePointerCapture(e.pointerId); } catch (_) { }

      const dx = Math.abs(e.clientX - dragStartPos.x);
      const dy = Math.abs(e.clientY - dragStartPos.y);

      if (dx < 10 && dy < 10 && !wasDragged) {
        flipCard();
      } else {
        vel.x = dragVel.x * 0.8;
        vel.y = dragVel.y * 0.8;

        const pullDistance = Math.sqrt(dx * dx + dy * dy);
        if (pullDistance > 50) {
          setTimeout(() => {
            flipCard();
          }, 150);
        }
      }
    };

    function flipCard() {
      isFlipped = !isFlipped;
      cardSpin.classList.add('flipping');
      cardSpin.style.transform = isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';

      setTimeout(() => {
        cardSpin.classList.remove('flipping');
      }, 500);
    }

    const onPointerMove = (e) => {
      if (!dragging) return;

      const targetCx = e.clientX + dragOffset.x;
      const targetCy = e.clientY + dragOffset.y;

      // We need to calculate pos relative to anchor in the container context
      // The mouse coordinates are global, but anchor is relative to container?
      // Wait, in the original code:
      // pos.x = targetCx - anchor.x;
      // anchor.x was window.innerWidth / 2.
      // Here anchor.x is container center.
      // But targetCx is clientX (global).
      // We need to adjust for container position.

      const containerRect = container.getBoundingClientRect();
      const containerCenterX = containerRect.left + containerRect.width / 2;
      const containerTopY = containerRect.top; // anchor.y is relative to top of container?

      // The original code: anchor.y = 74 (fixed from top of window)
      // Here anchor.y = 74 (relative to container top)

      // So pos.x should be relative to anchor.
      // targetCx is global X.
      // anchor global X is containerCenterX.

      pos.x = targetCx - containerCenterX;
      pos.y = targetCy - (containerTopY + anchor.y);

      const dx = Math.abs(e.clientX - dragStartPos.x);
      const dy = Math.abs(e.clientY - dragStartPos.y);
      if (dx > 10 || dy > 10) {
        wasDragged = true;
      }

      const now = performance.now();
      const dtp = Math.max((now - lastDragTime) / 1000, 0.001);
      dragVel.x = (pos.x - lastDragPos.x) / dtp;
      dragVel.y = (pos.y - lastDragPos.y) / dtp;
      lastDragTime = now;
      lastDragPos.x = pos.x;
      lastDragPos.y = pos.y;
    };

    cardOuter.addEventListener("pointerdown", onPointerDown);
    cardOuter.addEventListener("pointerup", endDrag);
    cardOuter.addEventListener("pointercancel", endDrag);
    document.addEventListener("pointermove", onPointerMove);

    let lastTime = null;
    let animationFrameId;

    function animate(ts) {
      if (!lastTime) lastTime = ts;
      const dt = Math.min((ts - lastTime) / 1000, 0.03);
      lastTime = ts;

      if (!dragging) {
        const dx = pos.x - restPos.x;
        const dy = pos.y - restPos.y;

        const Fx = -kSpring * dx - damping * vel.x;
        const Fy = -kSpring * dy - damping * vel.y + gravity;

        vel.x += Fx * dt;
        vel.y += Fy * dt;

        pos.x += vel.x * dt;
        pos.y += vel.y * dt;
      }

      const cx = anchor.x + pos.x;
      const cy = anchor.y + pos.y;

      cardOuter.style.left = (cx - CARD_W / 2) + "px";
      cardOuter.style.top = (cy - CARD_H / 2) + "px";

      const attachX = cx;
      const attachY = cy - CARD_H / 2 - CLIP_HEIGHT / 2;

      const ax = anchor.x;
      const ay = anchor.y;
      const bx = attachX;
      const by = attachY;

      const dxL = bx - ax;
      const dyL = by - ay;
      const dist = Math.sqrt(dxL * dxL + dyL * dyL) || 1;

      const midX = (ax + bx) / 2;
      const midY = (ay + by) / 2;

      const maxRopeLength = 280;
      const slack = Math.max(0, maxRopeLength - dist);
      const sagAmount = slack * 0.15 + 20;

      const sagX = midX;
      const sagY = midY + sagAmount;

      const pathD = `M ${ax} ${ay} Q ${sagX} ${sagY}, ${bx} ${by}`;
      lanyardPath.setAttribute("d", pathD);
      lanyardPathBorder.setAttribute("d", pathD);

      updateLanyardLogos(ax, ay, sagX, sagY, bx, by);

      animationFrameId = requestAnimationFrame(animate);
    }

    function updateLanyardLogos(ax, ay, cx, cy, bx, by) {
      lanyardLogos.innerHTML = '';

      const numLogos = 3;
      for (let i = 1; i < numLogos; i++) {
        const t = i / numLogos;
        const x = Math.pow(1 - t, 2) * ax + 2 * (1 - t) * t * cx + Math.pow(t, 2) * bx;
        const y = Math.pow(1 - t, 2) * ay + 2 * (1 - t) * t * cy + Math.pow(t, 2) * by;

        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('href', '/assets/fox.png');
        image.setAttribute('x', x - 10);
        image.setAttribute('y', y - 10);
        image.setAttribute('width', '20');
        image.setAttribute('height', '20');
        lanyardLogos.appendChild(image);
      }
    }

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", handleResize);
      cardOuter.removeEventListener("pointerdown", onPointerDown);
      cardOuter.removeEventListener("pointerup", endDrag);
      cardOuter.removeEventListener("pointercancel", endDrag);
      document.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Use employee data if available, otherwise defaults
  const name = employee?.name || "DIVYA LAHAD";
  const designation = employee?.designation || "Product Designer";
  const empId = employee?.employeeId || "MG-0247";
  const photo = employee?.photo || null;
  const phone = employee?.phone || "+91 98765 43210";
  const bloodGroup = employee?.bloodGroup || "B+";
  const email = employee?.email || "user@example.com";
  const address = employee?.address || "Not Provided";

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const dob = formatDate(employee?.dob);
  const joiningDate = formatDate(employee?.joiningDate);

  return (
    <div className="lanyard-scene" ref={containerRef}>
      <div className="anchor-dot"></div>

      <svg className="lanyard-svg">
        <defs>
          <linearGradient id="lanyard-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: "#5eada4" }} />
            <stop offset="100%" style={{ stopColor: "#6bc4ba" }} />
          </linearGradient>

          <pattern id="lanyard-logo-pattern" patternUnits="userSpaceOnUse" width="60" height="40" patternTransform="rotate(0)">
            <rect width="60" height="40" fill="#5eada4" />
            <text x="30" y="25" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontFamily="Inter, sans-serif" fontSize="11" fontWeight="700">MG</text>
          </pattern>
        </defs>
        <path id="lanyard-path-border" className="lanyard-path-border" ref={lanyardPathBorderRef}></path>
        <path id="lanyard-path" className="lanyard-path" ref={lanyardPathRef}></path>

        <g id="lanyard-logos" ref={lanyardLogosRef}></g>
      </svg>

      <div className="card-outer" ref={cardOuterRef} id="card-outer">
        <div className="card-clip"></div>
        <div className="card-spin" ref={cardSpinRef} id="card-spin">
          {/* FRONT */}
          <div className="card-face front">
            <div className="card-shine"></div>

            {/* Header removed as requested */}
            <div style={{ height: '12px' }}></div>

            <div className="profile-section">
              <div className="avatar-container">
                <div className="avatar">
                  {photo ? (
                    <img src={photo} alt={name} />
                  ) : (
                    <span className="avatar-placeholder">Employee<br />Photo</span>
                  )}
                </div>
                {/* Camera button for image upload */}
                {onImageClick && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      console.log('Camera button clicked, calling onImageClick');
                      onImageClick();
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                    }}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      console.log('Camera button touched, calling onImageClick');
                      onImageClick();
                    }}
                    disabled={uploadingImage}
                    className="avatar-camera-btn"
                  >
                    {uploadingImage ? (
                      <div style={{ width: '16px', height: '16px', border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <FaCamera className="camera-icon" style={{ color: '#ffffff', fontSize: '18px', width: '18px', height: '18px', display: 'block' }} />
                    )}
                  </button>
                )}
              </div>
              <div className="emp-name">{name}</div>
              <div className="emp-designation">{designation}</div>
              <div className="emp-id">ID: {empId}</div>
            </div>

            <div className="info-section">
              <div className="info-row">
                <div className="info-item">
                  <div className="label">Phone</div>
                  <div className="value">{phone}</div>
                </div>
                <div className="info-item center">
                  <div className="label">Blood</div>
                  <div className="blood-badge">{bloodGroup}</div>
                </div>
              </div>
              <div className="info-row" style={{ marginTop: '8px' }}>
                <div className="info-item">
                  <div className="label">DOB</div>
                  <div className="value">{dob}</div>
                </div>
                <div className="info-item">
                  <div className="label">Joined</div>
                  <div className="value">{joiningDate}</div>
                </div>
              </div>
            </div>

            <div className="footer-row">
              Tap to flip • Wear visibly inside premises
            </div>
          </div>

          {/* BACK */}
          <div className="card-face back">
            <div className="card-shine"></div>

            <div className="back-content">
              {/* Website Logo Placeholder */}
              <div className="back-logo" style={{ background: '#111827', padding: '15px' }}>
                <img src="/assets/lanyard-card-logo.webp" alt="Talio" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>

              <div className="back-contact" style={{ width: '100%', alignItems: 'flex-start', padding: '0 4px', marginTop: '20px' }}>
                <div className="info-item" style={{ marginBottom: '12px', width: '100%' }}>
                  <div className="label" style={{ marginBottom: '2px' }}>Email</div>
                  <div className="value" style={{ wordBreak: 'break-all', fontSize: '13px' }}>{email}</div>
                </div>
                <div className="info-item" style={{ marginBottom: '12px', width: '100%' }}>
                  <div className="label" style={{ marginBottom: '2px' }}>Address</div>
                  <div className="value" style={{ lineHeight: '1.4', fontSize: '13px' }}>{address}</div>
                </div>
              </div>
            </div>

            <div className="back-footer">
              If found, please return to<br />
              <span>Talio HRMS</span>
            </div>
          </div>
        </div>
      </div>

      <div className="helper-text">
        <strong>Drag</strong> to swing the card • <strong>Tap</strong> to flip
      </div>
    </div>
  );
}
