      const initFabricCanvas = async () => {
        try {
          console.log('[Vue Editor] Starting Fabric initialization...');

          // Load Fabric.js
          const { loadFabric } = await import('./editorWidget.js');
          const fabric = await loadFabric();
          console.log('[Vue Editor] Fabric loaded:', !!fabric);
          console.log('[Vue Editor] Fabric version:', fabric.version);
          console.log('[Vue Editor] Fabric.Canvas available:', !!fabric.Canvas);

          // Get canvas element via ref
          const canvasEl = canvasRef.value;
          console.log('[Vue Editor] Canvas element ref:', canvasEl);

          if (!canvasEl) {
            throw new Error('Canvas element ref is null');
          }

          if (!fabric || !fabric.Canvas) {
            throw new Error('fabric.Canvas is not available - Fabric.js not loaded correctly');
          }

          // Create Fabric canvas
          fabricCanvas.value = new fabric.Canvas(canvasEl, {
            width: DEFAULT_CANVAS_WIDTH,
            height: DEFAULT_CANVAS_HEIGHT,
            backgroundColor: '#2c2c2c',
            selection: true
          });

          console.log('[Vue Editor] Fabric Canvas created:', fabricCanvas.value);

          // Set up event listeners
          fabricCanvas.value.on('object:modified', () => {
            console.log('[Vue Editor] Canvas object modified');
            emit('canvas-dirty', true);
          });

          fabricCanvas.value.on('object:added', () => {
            console.log('[Vue Editor] Canvas object added');
            emit('canvas-dirty', true);
          });

          // Update loading state
          loading.value = false;

          // Emit canvas ready and store in state
          emit('canvas-ready', fabricCanvas.value);
          setCanvas(props.nodeId, fabricCanvas.value);

          console.log('[Vue Editor] Fabric canvas initialized successfully');

        } catch (error) {
          console.error('[Vue Editor] Failed to initialize canvas:', error);
          console.error('[Vue Editor] Error details:', {
            message: error.message,
            stack: error.stack,
            fabricAvailable: !!window.fabric,
            fabricType: typeof window.fabric
          });
          loading.value = false;
        }
      };