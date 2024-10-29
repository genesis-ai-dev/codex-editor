import { TimeBlock } from "../../../../../types";

const toFixed3 = (i: number): number => Number(i.toFixed(3));

export interface TimelineReturn {
    setData: (alignments: TimeBlock[]) => void;
    cancelAnimate: () => void;
    changeZoom: (deltaY: number) => void;
    changeCursorViewPort: (beginingTimeShow: number, endTimeShow: number) => void;
}

export default function TimeLine({
    canvas,
    canvas2,
    alignments,
    endTime,
    setContentToScrollTo,
    getPlayer,
    changeAlignment,
    changeZoomLevel,
    changeInScrollPosition,
    changeShift,
    tellAreaChangesToRectComponent,
    options,
}: {
    canvas: HTMLCanvasElement;
    canvas2: HTMLCanvasElement;
    alignments: TimeBlock[];
    setContentToScrollTo: React.Dispatch<React.SetStateAction<string | null>>;
    endTime: number;
    getPlayer: () => { currentTime: number; play: (currentTime: number) => void };
    changeAlignment: (
        alignments: {
            begin: number;
            end: number;
            text: string;
            id: string;
        }[]
    ) => void;
    changeZoomLevel: (zoomLevel: number) => void;
    changeInScrollPosition: (position: number) => void;
    changeShift: (shift: number) => void;
    tellAreaChangesToRectComponent: (beginingTimeShow: number, endTimeShow: number) => void;
    options: {
        autoScroll: boolean;
        initialZoomLevel?: number; // Add this to options
        scrollingIsTracking: boolean;
        scrollPosition: number;
        colors: {
            background: string;
            box: string;
            boxHover: string;
            selectedBox: string;
            playingBox: string;
            text: string;
            selectedText: string;
            tooltipBackground: string;
            tooltipText: string;
            scrollBarBackground: string;
            scrollBar: string;
            scrollBarHover: string;
        };
    };
}): TimelineReturn | undefined {
    // constants
    const LINE_HEIGHT = 40;
    const TRACK_HEIGHT = 40;
    const TIME_BAR_MARGIN = 17;
    const TIMELINE_HEIGHT = 90;
    const RESIZE_MODE_EDGE = 5;
    const SHIFT_SCALE = 4;
    const EXRTA_SHIFT = 60;
    const ZOOM_SCALE = 1.35;
    const MINIMUM_BLOCK_TIME = 1;
    const SCROLL_BAR_HEIGHT = 10; // colors

    const SELECTED_COLOR = options.colors.selectedBox;
    const ACTIVE_COLOR = options.colors.boxHover;
    const CURSUR_TIME_CONTAINER_COLOR = options.colors.playingBox;
    let scrolling = false;
    let autoScroll = options.autoScroll;
    let maximumShift = 10000;
    let isMouseDown = false;

    if (!canvas || !canvas2 || !alignments) {
        return;
    } // element setting

    let animationID: number;
    let w = (canvas.width = canvas2.width = canvas.parentElement?.parentElement?.clientWidth || 0);
    let h = (canvas.height = canvas2.height = TIMELINE_HEIGHT);
    let scrollPosition = options.scrollPosition;
    let scrollSize = w;
    const minimumZoomLevel = w / endTime;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    if (!ctx) {
        return;
    }
    const bgCtx = canvas2.getContext("2d");
    if (!bgCtx) {
        return;
    }
    ctx.lineWidth = 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "10px Arial";
    canvas.style.backgroundColor = "transparent";
    canvas2.style.backgroundColor = options.colors.background;
    let mouse: { x: number; y: number } = { x: 0, y: 0 };
    let lastXcursor = 0;
    let mouseTime: number;
    let swaping = false;
    let player: any;
    let shift = 0;
    let movingDirection: string;
    let zoomLevel = options.initialZoomLevel || w / endTime || 1; // Initialize with prop if available
    let moving = false;
    let resizing = false;
    let currentPrtcl: any;
    let currentHoveredIndex = -1;
    let currentPrtclsIndex: number;
    let rightResize = false;
    let leftResize = false;
    let globalRatio = 1;
    let currentTime = 0;
    let beginingTimeShow = 0;
    let endTimeShow = Math.abs(w + shift) / zoomLevel;
    let moveIndex: number;
    let newTime: number;
    let prtcls: Square[] = [];
    setData(alignments); //tooltip

    let tooltipTimeout: number;
    let visibleTooltip = false;
    let visitedPrtcl: number; // BEGIN ...

    addListenerHandlers(canvas);
    changeZoomLevel(zoomLevel);
    tellAreaChangesToRectComponent(beginingTimeShow, endTimeShow);
    drawBG(bgCtx);
    animate(); // HELPERS ...

    interface Square {
        x: number;
        y: number;
        text: string;
        edge: number;
        id: string;
        startIndex?: number;
        endIndex?: number;
        selected: boolean;
        active: boolean;
        index: number;
        draw: (context: CanvasRenderingContext2D) => void;
        constructor: new (
            x: number,
            y: number,
            edge: number,
            index: number,
            id: string,
            text: string,
            sIndex: number,
            eIndex: number
        ) => Square;
    }

    function Square(
        this: Square,
        x: number,
        y: number,
        edge: number,
        index: number,
        text: string,
        id: string,
        sIndex: number,
        eIndex: number
    ) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.id = id;
        this.edge = edge;
        this.startIndex = sIndex;
        this.endIndex = eIndex;
        this.selected = false;
        this.active = false;
        this.index = index;

        this.draw = (context) => {
            context.save();
            this.x = toFixed3(this.x);
            this.edge = toFixed3(this.edge);
            context.fillStyle = ACTIVE_COLOR;

            if (currentHoveredIndex !== this.index) {
                context.fillStyle = options.colors.box;
            }

            if (this.active) {
                context.fillStyle = ACTIVE_COLOR;
            }

            if (this.selected) {
                context.fillStyle = SELECTED_COLOR;
            }

            context.fillRect(this.x + shift, this.y, this.edge, TRACK_HEIGHT);
            context.beginPath();
            context.strokeStyle = "#888888";
            context.lineWidth = 1;
            context.moveTo(this.x + shift - 1 + this.edge, this.y + 1);
            context.lineTo(this.x + shift - 1 + this.edge, this.y + TRACK_HEIGHT);
            context.closePath();
            context.stroke();
            ctx.font = "13px Arial";
            context.fillStyle = options.colors.text;
            if (this.selected) context.fillStyle = options.colors.selectedText;
            const space = this.edge;
            const rat = ctx.measureText(this.text).width / space;
            const trimedText =
                rat <= 1
                    ? this.text
                    : this.text.substr(0, Math.floor((1 / rat) * this.text.length) - 1);
            if (trimedText && this.edge > 20)
                ctx.fillText(trimedText, this.x + 1 + shift, this.y + 22, this.edge - 2);
            context.restore();
        };
    }

    function getMouseCoords(canvas: HTMLCanvasElement, event: MouseEvent) {
        const canvasCoords = canvas.getBoundingClientRect();
        // let yy = event.pageY - canvas.offsetTop;
        // let xx = event.pageX - canvas.offsetLeft;
        const xxxx = event.pageX - canvasCoords.x;
        const yyyy = event.pageY - canvasCoords.y - window.pageYOffset;
        // console.log("canvasCoords", { canvasCoords, xxxx, yyyy });
        return {
            x: xxxx,
            y: yyyy,
        };
    }

    function getOffsetCoords(mouse: any, rect: any) {
        // console.log("mouse", mouse);
        // console.log("rect", rect);
        return {
            x: mouse.x - rect.x,
            y: mouse.y - rect.y,
        };
    }

    function cursorInRect(
        mouseX: number,
        mouseY: number,
        rectX: number,
        rectY: number,
        rectW: number,
        rectH: number
    ) {
        const xLine = mouseX > rectX + shift && mouseX < rectX + shift + rectW;
        const yLine = mouseY > rectY && mouseY < rectY + TRACK_HEIGHT;
        return xLine && yLine;
    }

    function resize() {
        w = canvas.width = canvas2.width = canvas.parentElement?.parentElement?.clientWidth || 0;
        h = canvas.height = canvas2.height = TIMELINE_HEIGHT;
        if (bgCtx) {
            drawBG(bgCtx);
        }
    }

    function changeZoom(deltaY: number) {
        handleZoom({
            deltaY,
            preventDefault: () => {},
        });
    }

    function handleZoom(e: { deltaY: number; preventDefault: () => void }) {
        try {
            e.preventDefault();
        } catch (error) {
            console.log(error);
        }

        if (resizing) return;
        const originalZoomLevel = zoomLevel;
        const originalMouseTime = mouseTime;
        const viewPortTime = endTimeShow - beginingTimeShow;

        if (e.deltaY < 0) {
            if (zoomLevel * ZOOM_SCALE < 500) zoomLevel *= ZOOM_SCALE;
        } else {
            if (zoomLevel / ZOOM_SCALE <= minimumZoomLevel) {
                zoomLevel = minimumZoomLevel;
            } else {
                if (viewPortTime < endTime) {
                    zoomLevel /= ZOOM_SCALE;
                }
            }
        }

        const newMouseTime = (mouse.x - shift) / zoomLevel;
        const newShift = (originalMouseTime - newMouseTime) * zoomLevel;

        if (shift - newShift > 0) {
            shift = 0;
        } else {
            shift = shift - newShift;
        }

        let ratio = 1;
        prtcls.forEach((p) => {
            const px = p.x;
            const originalPX = p.x / originalZoomLevel;
            const originalEdge = p.edge / originalZoomLevel;
            p.edge = originalEdge * zoomLevel;
            p.x = originalPX * zoomLevel;
            ratio = p.x / px;
        });
        checkShift();
        changeZoomLevel(zoomLevel);
        if (bgCtx) {
            drawBG(bgCtx, ratio);
        }
    }

    function drawTimeCursor() {
        const position = currentTime * zoomLevel + shift;
        const context = ctx;
        const pos = position !== undefined ? position : mouse ? mouse.x : undefined;
        if (pos === undefined) return; //temporary deactive hover cursor
        // currentHoveredIndex = prtcls.findIndex(
        //   (e) => pos - shift >= e.x && pos - shift <= e.x + e.edge
        // );

        context.save();
        context.fillStyle = CURSUR_TIME_CONTAINER_COLOR;
        context.fillRect(pos - 70, 21, 70, 17);
        context.fillStyle = "white";
        context.fillText(toTime((pos - shift) / zoomLevel, true), pos - 60, 30);
        context.lineWidth = 0.5;
        context.strokeStyle = CURSUR_TIME_CONTAINER_COLOR;
        context.beginPath();
        context.moveTo(pos, 0);
        context.lineTo(pos, 150);
        context.closePath();
        context.stroke();
        context.restore();
    }

    function mousemoveGeneral(e: MouseEvent) {
        e.preventDefault();
        mouse = getMouseCoords(canvas, e);

        if (lastXcursor < mouse.x) {
            movingDirection = "right";
        } else {
            movingDirection = "left";
        }

        lastXcursor = mouse.x;

        if (!moving && !resizing && !swaping && !scrolling) {
            // activePrtcl();
            checkResizing();
            hoverElement();
        }
    }

    function handleHoverTimeBar() {
        if (mouse.y < TIME_BAR_MARGIN) {
            canvas.classList.add("crosshair");
        } else {
            canvas.classList.remove("crosshair");
        }
    }

    function handleMouseMove(e: MouseEvent) {
        e.preventDefault();
        handleHoverTimeBar();
        if (!currentPrtcl) visibleTooltip = false;
        if (moving) {
            handleMoving();
        } else if (resizing) {
            handleResize(mouse);
        } else if (scrolling) {
            handleScrolling();
        } else if (swaping) {
            resetActives();
            handleVerticalSwipe();
        } else if (isMouseDown) {
            moving = true;
        } else {
            resetActives();
        }

        if (moving || scrolling || swaping) checkShift();
        if (bgCtx) {
            drawBG(bgCtx);
        }
    }
    function handleScrolling() {
        if (zoomLevel === minimumZoomLevel) return;

        const mouseDistancetToScroll = Math.abs(mouse.x - scrollPosition);
        const distance = scrollSize / 2;
        const ratio = (mouse.x - distance) / w;
        const value = -1 * ratio * endTime * zoomLevel;
        if (value <= 0) shift = value;
        if (bgCtx) {
            drawBG(bgCtx);
        }
    }
    function resetActives() {
        // prtcls.forEach((d) => {
        //   d.active = false;
        // });
    }
    function handleMoving() {
        if (!currentPrtcl) return;
        let min = 0;
        let max = 99999999;
        const leftSub = prtcls[currentPrtclsIndex - 1];
        const rightSub = prtcls[currentPrtclsIndex + 1];
        if (leftSub) min = leftSub.x + leftSub.edge;
        if (rightSub) max = rightSub.x;

        const pos = mouse.x - currentPrtcl.offset.x;

        if (pos + currentPrtcl.edge <= max && pos >= min) {
            currentPrtcl.x = pos;
            currentPrtcl.y = LINE_HEIGHT;
        } else {
            if (movingDirection === "right" && pos > currentPrtcl.x + currentPrtcl.edge)
                currentPrtcl.x = max - currentPrtcl.edge;
            if (movingDirection === "left" && pos < currentPrtcl.x) currentPrtcl.x = min;
        }
    }
    function outPrtcls() {
        const data = prtcls.map((p, i) => {
            const begin = toFixed3(p.x / zoomLevel);
            let end = toFixed3((p.x + p.edge) / zoomLevel);
            const text = p.text;

            if (prtcls[i + 1]) {
                const nextStart = toFixed3(prtcls[i + 1].x / zoomLevel);
                if (nextStart < end) end = nextStart;
            }

            return {
                begin,
                end,
                text,
                id: p.id,
            };
        });
        changeAlignment(data);
    }

    function handleVerticalSwipe() {
        if (swaping && zoomLevel !== minimumZoomLevel) {
            if (movingDirection === "left") {
                if ((w - shift) / zoomLevel > endTime + EXRTA_SHIFT) return;
                shift = shift - SHIFT_SCALE;
            } else if (movingDirection === "right") {
                if (shift + SHIFT_SCALE > 0) {
                    shift = 0;
                } else {
                    shift = shift + SHIFT_SCALE;
                }
            }

            if (bgCtx) {
                drawBG(bgCtx);
            }
        }
    }

    function calculateViewPortTimes() {
        beginingTimeShow = Math.abs(shift) / zoomLevel;
        endTimeShow = Math.abs(w - shift) / zoomLevel;
        mouseTime = (mouse.x - shift) / zoomLevel;
        tellAreaChangesToRectComponent(beginingTimeShow, endTimeShow);
        changeShift(shift);
    }

    function handleDbClick() {
        if (currentPrtcl) {
            if (
                cursorInRect(
                    mouse.x,
                    mouse.y,
                    currentPrtcl.x,
                    currentPrtcl.y,
                    currentPrtcl.edge,
                    currentPrtcl.edge
                )
            ) {
                currentPrtcl.selected = true;
                currentPrtcl.offset = getOffsetCoords(mouse, currentPrtcl);
                player.currentTime = currentPrtcl.x / zoomLevel;
                player.play(player.currentTime);
                setContentToScrollTo(currentPrtcl.id);
            } else {
                currentPrtcl.selected = false;
            }
        }
    }

    function handleCursor() {
        // if (swaping) {
        //   canvas.classList.add("grabbing");
        // } else {
        //   canvas.classList.remove("grabbing");
        // }
        // if (currentPrtcl) {
        //   canvas.classList.add("move");
        // } else {
        //   canvas.classList.remove("move");
        // }
    }

    function handleMouseDown() {
        isMouseDown = true;

        if (rightResize || leftResize) {
            resizing = true;
            handlePauseInChanging();
        }

        if (currentPrtcl) {
            if (
                cursorInRect(
                    mouse.x,
                    mouse.y,
                    currentPrtcl.x,
                    currentPrtcl.y,
                    currentPrtcl.edge,
                    currentPrtcl.edge
                )
            ) {
                currentPrtcl.selected = true;
                currentPrtcl.offset = getOffsetCoords(mouse, currentPrtcl);

                if (resizing) {
                    handlePauseInChanging();
                }
            } else {
                currentPrtcl.selected = false;
            }
        } else if (!resizing) {
            // hande click to change player current time
            if (mouse.y < TIME_BAR_MARGIN) {
                player.currentTime = (mouse.x - shift) / zoomLevel;
            } else if (mouse.y > TIME_BAR_MARGIN && mouse.y < TIMELINE_HEIGHT - SCROLL_BAR_HEIGHT) {
                swaping = true;
            }

            player.play(player.currentTime);
        }
    }

    function handlePauseInChanging() {
        if (player) {
            // player.pause();
        }
    }

    function mouseup() {
        isMouseDown = false;
        canvas.classList.remove("col-resize");

        if (resizing) {
            // player.play();
        }

        if (moving) {
            // player.play();
        }

        resizing = false;
        moving = false;
        swaping = false;
        stopMove = false;
        prtcls.forEach((e) => (e.selected = false));
        if (currentPrtcl) currentPrtcl.active = true;
        outPrtcls();
    }

    function checkResizing() {
        if (currentPrtcl) {
            if (
                mouse.x >= currentPrtcl.x + shift + currentPrtcl.edge - RESIZE_MODE_EDGE &&
                mouse.x <= currentPrtcl.x + shift + currentPrtcl.edge
            ) {
                rightResize = true;
                canvas.classList.add("col-resize");
            } else if (
                mouse.x <= currentPrtcl.x + shift + RESIZE_MODE_EDGE &&
                mouse.x >= currentPrtcl.x + shift
            ) {
                leftResize = true;
                canvas.classList.add("col-resize");
            } else {
                leftResize = false;
                rightResize = false;
                canvas.classList.remove("col-resize");
            }
        } else {
            leftResize = false;
            rightResize = false;
            canvas.classList.remove("col-resize");
        }
    }

    function setTooltipTimeout() {
        visibleTooltip = true;
        visitedPrtcl = -1;
    }

    function hoverElement() {
        if (currentPrtclsIndex > -1) {
            if (visitedPrtcl === -1) {
                visibleTooltip = false;
                clearTimeout(tooltipTimeout);
                visitedPrtcl = currentPrtclsIndex;
                tooltipTimeout = setTimeout(setTooltipTimeout, 700);
            }

            canvas.classList.add("move");
        } else {
            visibleTooltip = false;
            clearTimeout(tooltipTimeout);
            visitedPrtcl = -1;
            canvas.classList.remove("move");
        }
    }

    let stopMove = false;

    function handleResize(mouse: { x: number; y: number }) {
        const mousePosition = mouse.x - shift;
        let min = 0;
        let max = 99999999;
        handlePauseInChanging();
        const leftSub = prtcls[moveIndex - 1];
        const rightSub = prtcls[moveIndex + 1];
        if (leftSub) min = leftSub.x + leftSub.edge + shift;
        if (rightSub) max = rightSub.x + shift;

        if (currentPrtcl?.selected) {
            if (rightResize) {
                const distanceToBegin = mouse.x - currentPrtcl.x - shift;

                if (mouse.x <= max && mouse.x > currentPrtcl.x + MINIMUM_BLOCK_TIME + shift) {
                    currentPrtcl.edge = distanceToBegin;
                } else if (mouse.x > max) {
                    const innersubs = prtcls.filter(
                        (p) => p.x > currentPrtcl.x && p.x + p.edge < mousePosition
                    );
                    if (innersubs.length > 1) return;
                    currentPrtcl.edge = distanceToBegin;
                    newTime = currentPrtcl.x + currentPrtcl.edge;
                    const inners = prtcls.filter((p) => p.x > currentPrtcl.x);
                    inners.forEach((inner) => {
                        if (inner.x < newTime) {
                            if (inner.edge > MINIMUM_BLOCK_TIME * zoomLevel) {
                                const endPoint = inner.x + inner.edge;
                                inner.x = newTime;
                                inner.edge = endPoint - inner.x;
                            } else {
                                inner.x = newTime;
                            }
                        } else {
                            // if (inner.x < newTime) {
                            //   inner.x = newTime;
                            // }
                        }

                        newTime = inner.x + inner.edge;
                    });
                }
            } else {
                const endPoint = currentPrtcl.x + currentPrtcl.edge;

                if (mouse.x > min && mouse.x < currentPrtcl.x + currentPrtcl.edge - 0.3 + shift) {
                    currentPrtcl.x = mouse.x - shift;
                    currentPrtcl.edge = endPoint - mouse.x + shift;
                } else if (mouse.x < min) {
                    if (stopMove) return;
                    const innersubs = prtcls.filter(
                        (p) => p.x + p.edge > mousePosition && p.x < currentPrtcl.x
                    );
                    if (innersubs.length > 1) return;
                    const inners = prtcls.filter((p) => p.x < mouse.x - shift);
                    newTime = mouse.x - shift;

                    for (let i = inners.length - 1; i >= 0; i--) {
                        if (inners[i].x + inners[i].edge > newTime) {
                            if (inners[i].edge > MINIMUM_BLOCK_TIME * zoomLevel) {
                                currentPrtcl.x = mouse.x - shift;
                                currentPrtcl.edge = endPoint - mouse.x + shift;
                                inners[i].edge = newTime - inners[i].x;
                            } else {
                                if (newTime - inners[i].edge < 0) {
                                    stopMove = true;
                                } else {
                                    currentPrtcl.x = mouse.x - shift;
                                    currentPrtcl.edge = endPoint - mouse.x + shift;
                                    inners[i].x = newTime - inners[i].edge;
                                    newTime = inners[i].x;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    function toTime(s: number, withMilliSecond: boolean) {
        try {
            if (withMilliSecond) return new Date(s * 1000).toISOString().substr(11, 11);
            return new Date(s * 1000).toISOString().substr(11, 8);
        } catch (error) {
            return "";
        }
    }

    function setData(aligns: TimeBlock[]) {
        // console.log({ aligns });
        prtcls = aligns.map(
            (p, i) =>
                // @ts-expect-error: square is some how a class
                new Square(
                    p.begin * zoomLevel,
                    LINE_HEIGHT,
                    (p.end - p.begin) * zoomLevel,
                    i,
                    p.text,
                    p.id
                    // p.startIndex,
                    // p.endIndex
                )
        );
        return prtcls;
    }

    function showTooltip() {
        if (currentPrtcl) {
            ctx.save();
            ctx.translate(mouse.x + 10, mouse.y - 10);
            ctx.fillStyle = options.colors.tooltipBackground;
            ctx.font = "12px Arial";
            const width = ctx.measureText(currentPrtcl.text).width;
            const height = 20;
            ctx.fillRect(5 + width / -2, -22, width + 20, height);
            ctx.fillStyle = options.colors.tooltipText;
            ctx.fillText(currentPrtcl.text, 15 + width / -2, -12);
            ctx.restore();
        }
    }

    function cancelAnimate() {
        cancelAnimationFrame(animationID);
    }

    function handleCursorOutOfViewPort(time: number) {
        if (!autoScroll || scrolling || !options.scrollingIsTracking) return;

        const viewportWidth = endTimeShow - beginingTimeShow;
        const margin = viewportWidth * 0.2; // 20% margin

        // Calculate cursor position relative to viewport
        const cursorPosition = time;
        const distanceFromEnd = endTimeShow - cursorPosition;
        const distanceFromStart = cursorPosition - beginingTimeShow;

        // Scroll if cursor is too close to edges
        if (distanceFromEnd < margin) {
            // Cursor is near right edge - scroll right
            const targetShift = -1 * (time * zoomLevel - w * 0.7);
            shift = Math.max(targetShift, maximumShift);
        } else if (distanceFromStart < margin) {
            // Cursor is near left edge - scroll left
            const targetShift = -1 * (time * zoomLevel - w * 0.3);
            shift = Math.min(targetShift, 0);
        }

        checkShift();
        if (bgCtx) {
            drawBG(bgCtx);
        }
    }

    function changeCursorViewPort(time: number) {
        if (scrolling) return;
        const transitionLevel = 1;
        const margin = (endTimeShow - beginingTimeShow) * 0.2;
        const remainingTime = endTimeShow - time;

        if (remainingTime < margin && autoScroll) {
            const delta = margin - remainingTime;

            if (shift - delta * zoomLevel * transitionLevel < maximumShift) {
                shift = maximumShift;
            } else {
                shift -= delta * zoomLevel * transitionLevel;
            }
        } else if (endTimeShow < time || beginingTimeShow > time) {
            let s;

            if (endTimeShow <= time) {
                s = -1 * time * zoomLevel + w * 0.8;
            } else {
                s = -1 * time * zoomLevel + 200;
            }

            if (s < 0) {
                shift = s;
            } else {
                shift = 0;
            }
        }

        checkShift();
        if (bgCtx) {
            drawBG(bgCtx);
        }
    }

    function drawBG(context: CanvasRenderingContext2D, r = 1) {
        let rat = 5;
        if (zoomLevel > 50) rat = 10;
        if (zoomLevel > 100) rat = 15;
        if (zoomLevel > 150) rat = 20;
        if (zoomLevel > 200) rat = 25;

        globalRatio = globalRatio * r;
        context.save();
        context.clearRect(0, 0, canvas2.width, canvas2.height);
        context.fillStyle = "transparent";
        context.fillRect(0, 0, w, h);
        context.lineWidth = 0.3;
        context.strokeStyle = "lightgrey";
        context.fillStyle = "grey"; // vertical grid

        drawVerticalGrid(context);
        context.lineWidth = 0.5;
        context.strokeStyle = "grey"; //X-Axis

        drawXaxis(context);

        function drawVerticalGrid(ctx: CanvasRenderingContext2D) {
            const initNumber = shift % zoomLevel;

            for (let i = initNumber; i < w; i += zoomLevel / rat) {
                if (i > 0) {
                    ctx.beginPath();
                    ctx.moveTo(i, 0);
                    ctx.lineTo(i, h);
                    ctx.moveTo(i, 0);

                    ctx.closePath();
                    ctx.stroke();
                }
            }
        }

        function drawXaxis(ctx: CanvasRenderingContext2D) {
            ctx.beginPath();
            let counter = 0;
            const initNumber = shift % zoomLevel;
            for (let i = initNumber; i < w; i += zoomLevel / rat) {
                if (counter % rat === 0) {
                    ctx.moveTo(i, 0);
                    ctx.lineTo(i, 30);
                    context.fillStyle = "grey";
                    if (zoomLevel > 50) {
                        ctx.fillText(
                            ` ${toTime((i - shift) / zoomLevel, false)}`,
                            i,
                            30,
                            zoomLevel - 2
                        );
                    } else {
                        // let viewPortTime = endTimeShow - beginingTimeShow;
                        ctx.fillText(
                            ` ${new Date(((i - shift) / zoomLevel) * 1000)
                                .toISOString()
                                .substr(endTime > 7000 ? 11 : 14, 5)}`,
                            i,
                            30,
                            zoomLevel - 2
                        );
                    }
                } else {
                    ctx.moveTo(i, 0);
                    ctx.lineTo(i, 10);
                }
                counter++;
            }

            ctx.closePath();
            ctx.stroke();
        }
    }

    function handleClick(e: MouseEvent) {
        scrolling =
            cursorInScrollBar() && isMouseDown && !resizing && !moving && !resizing && !swaping;
    }

    function cursorInScrollBar() {
        if (
            mouse.x > scrollPosition &&
            mouse.x < scrollPosition + scrollSize &&
            mouse.y > TIMELINE_HEIGHT - SCROLL_BAR_HEIGHT &&
            mouse.y < TIMELINE_HEIGHT
        ) {
            return true;
        } else {
            if (scrolling && !resizing && !swaping) return true;
        }

        return false;
    }

    function changeAutoScroll(a: any) {
        autoScroll = a.detail.status;
    }

    function drawScroll() {
        if (options.scrollingIsTracking) return;
        const cursorInScroll = cursorInScrollBar();
        scrolling = cursorInScroll && isMouseDown && !resizing;
        if (cursorInScroll || scrolling) {
            canvas.classList.add("e-resize");
        } else {
            canvas.classList.remove("e-resize");
        }
        const context = ctx;
        context.save();
        context.fillStyle = options.colors.scrollBarBackground;
        context.fillRect(0, TIMELINE_HEIGHT - 10, w, 10);
        context.fillStyle =
            cursorInScroll || scrolling ? options.colors.scrollBarHover : options.colors.scrollBar;
        const d = endTimeShow - beginingTimeShow;
        let rat = d / endTime;
        if (rat > 1) rat = 10;
        scrollSize = Math.max(w * rat, 10);
        const ratio = beginingTimeShow / endTime;
        scrollPosition = ratio * w;
        changeInScrollPosition(scrollPosition);
        const padding = 1;
        // console.log({
        //     scrollSize,
        //     scrollPosition,
        //     2: TIMELINE_HEIGHT - SCROLL_BAR_HEIGHT + padding,
        //     4: SCROLL_BAR_HEIGHT - 2 - 2 * padding,
        // });
        context.fillRect(
            scrollPosition,
            TIMELINE_HEIGHT - SCROLL_BAR_HEIGHT + padding,
            scrollSize,
            SCROLL_BAR_HEIGHT - 2 - 2 * padding
        );
        context.restore();
    }

    function addListenerHandlers(canvas: HTMLCanvasElement) {
        window.removeEventListener("resize", resize);
        window.addEventListener("resize", resize);
        // canvas.removeEventListener("wheel", handleZoom);
        // canvas.addEventListener("wheel", handleZoom);
        canvas.removeEventListener("mousemove", mousemoveGeneral);
        canvas.addEventListener("mousemove", mousemoveGeneral);
        canvas.removeEventListener("mousemove", handleMouseMove);
        canvas.addEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", mouseup);
        window.addEventListener("mouseup", mouseup);
        canvas.removeEventListener("mousedown", handleMouseDown);
        canvas.addEventListener("mousedown", handleMouseDown);
        canvas.removeEventListener("dblclick", handleDbClick);
        canvas.addEventListener("dblclick", handleDbClick);
        window.removeEventListener("changeAutoScroll", changeAutoScroll);
        window.addEventListener("changeAutoScroll", changeAutoScroll);
        canvas.removeEventListener("click", handleClick);
        canvas.addEventListener("click", handleClick);
    }

    function checkShift() {
        const newShift = w - endTime * zoomLevel;

        if (newShift > 0) {
            maximumShift = 0;
        } else {
            maximumShift = newShift;
        }

        if (shift < maximumShift) {
            shift = maximumShift;
        }
    }

    function animate() {
        if (!player) player = getPlayer();
        currentTime = player.currentTime || 0;
        calculateViewPortTimes();
        if (player) handleCursorOutOfViewPort(currentTime);

        ctx.clearRect(0, 0, w, ctx.canvas.height);

        if (!moving) currentPrtclsIndex = -1;
        currentHoveredIndex = -1;
        prtcls.filter((e, i) => {
            const isHoveredPrtcl = cursorInRect(mouse.x, mouse.y, e.x, e.y, e.edge, e.edge);
            const position = currentTime * zoomLevel + shift;

            if (position - shift >= e.x && position - shift <= e.x + e.edge) {
                currentHoveredIndex = i;
            }

            if (isHoveredPrtcl && !resizing && !moving) currentPrtclsIndex = i;
            e.active = !!isHoveredPrtcl;

            const condition =
                (e.x >= -1 * shift && e.x + e.edge < -1 * shift + w) ||
                (e.x + e.edge > -1 * shift && e.x < -1 * shift + w);

            if (condition) {
                e.draw(ctx);
            }

            return condition;
        });

        if (!resizing && !moving) {
            moveIndex = currentPrtclsIndex;
            currentPrtcl = prtcls[currentPrtclsIndex];
        }

        if (beginingTimeShow > endTime) shift = endTime - beginingTimeShow; //red cursor time

        drawTimeCursor();
        drawScroll();
        checkShift();

        if (visibleTooltip && !resizing && !moving && !leftResize && !rightResize) {
            showTooltip();
        }

        handleCursor();
        animationID = window.requestAnimationFrame(animate);
    }

    return {
        setData,
        cancelAnimate,
        changeZoom,
        changeCursorViewPort,
    };
}
