import React, { useState, useEffect, useReducer, useRef } from 'react';
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

interface ProgressNotificationProps {
  progress: number | null;
  totalCells: number;
  completedCells: number;
  isVisible: boolean;
  currentCellId?: string; // Optional ID of the cell currently being processed
  isSingleCell?: boolean; // Whether this is a single cell translation
}

// Simple reducer that just increments a counter to force re-renders
const forceUpdateReducer = (state: number): number => state + 1;

const ProgressNotification: React.FC<ProgressNotificationProps> = ({ 
  progress, 
  totalCells, 
  completedCells,
  isVisible,
  currentCellId,
  isSingleCell
}) => {
  // Create a stable reference for the total number of cells to prevent fluctuations
  const stableTotalRef = useRef(totalCells);
  // Create a ref to store the highest completed count we've seen
  const highestCompletedRef = useRef(0);
  
  const [isDismissed, setIsDismissed] = useState(false);
  const [localCompleted, setLocalCompleted] = useState<number>(0);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [showInProgressUI, setShowInProgressUI] = useState(true); // UI state control
  
  // Track when we're in transition to keep notification visible
  const [inTransitionPeriod, setInTransitionPeriod] = useState(false);
  // Track when we're in the final completion state
  const [inCompletionState, setInCompletionState] = useState(false);
  
  const completionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transitionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasCompletedRef = useRef(false);
  const forcedVisibilityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const manualOverrideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoDismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track how long we've been at 100% without transitioning
  const stuckAt100TimerRef = useRef<NodeJS.Timeout | null>(null);
  const stuck100StartTimeRef = useRef<number | null>(null);
  
  // Ref to track if we've reached final count to avoid duplicate transitions
  const reachedFinalCountRef = useRef(false);
  
  // Track the last time we scheduled a transition timer
  const lastTransitionScheduledTimeRef = useRef<number | null>(null);
  
  // Track when the auto-dismiss timer was set
  const autoDismissSetTimeRef = useRef<number | null>(null);
  
  // Store the last time we completed a session - use this to detect new sessions
  const lastSessionCompletionTimeRef = useRef<number | null>(null);
  
  // Static tracking for completion state to avoid re-triggering between renders
  // This ensures we only show the completion notification once per session
  const staticCompletionTracker = useRef<{
    sessionId: string;
    hasShownCompletion: boolean;
    completionShownAt: number | null;
    dismissScheduled: boolean;
  }>({ 
    sessionId: Date.now().toString(), 
    hasShownCompletion: false,
    completionShownAt: null,
    dismissScheduled: false
  });
  
  // Use reducer as a "forceUpdate" mechanism
  const [, forceUpdate] = useReducer(forceUpdateReducer, 0);

  // Reset all state for a new session
  const resetAllState = () => {
    console.log("🔄 Completely resetting progress notification state for new session");
    setIsDismissed(false);
    setShowCompletionMessage(false);
    setShowInProgressUI(true);
    setInTransitionPeriod(false);
    setInCompletionState(false);
    
    // Reset refs
    reachedFinalCountRef.current = false;
    highestCompletedRef.current = 0;
    hasCompletedRef.current = false;
    stableTotalRef.current = totalCells;
    lastTransitionScheduledTimeRef.current = null;
    autoDismissSetTimeRef.current = null;
    stuck100StartTimeRef.current = null;
    
    // Initial value to 0
    setLocalCompleted(0);
    
    // Clear all timers
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (stuckAt100TimerRef.current) {
      clearTimeout(stuckAt100TimerRef.current);
      stuckAt100TimerRef.current = null;
    }
    if (manualOverrideTimerRef.current) {
      clearTimeout(manualOverrideTimerRef.current);
      manualOverrideTimerRef.current = null;
    }
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
    if (forcedVisibilityTimerRef.current) {
      clearTimeout(forcedVisibilityTimerRef.current);
      forcedVisibilityTimerRef.current = null;
    }
    
    // Reset the static tracker
    staticCompletionTracker.current = { 
      sessionId: Date.now().toString(), 
      hasShownCompletion: false,
      completionShownAt: null,
      dismissScheduled: false
    };
    
    console.log("🆕 Created new progress session:", staticCompletionTracker.current.sessionId);
  };

  // Update stable total ref when totalCells changes and it's not zero
  // This prevents the total from fluctuating during completion
  useEffect(() => {
    if (totalCells > 0 && !inCompletionState) {
      stableTotalRef.current = totalCells;
    }
  }, [totalCells, inCompletionState]);

  // Debug log
  console.log("🔔 ProgressNotification render:", { 
    progress, 
    totalCells,
    stableTotal: stableTotalRef.current,
    completedCells, 
    highestCompleted: highestCompletedRef.current,
    isVisible, 
    isDismissed,
    localCompleted,
    currentCellId,
    showCompletionMessage,
    showInProgressUI,
    inTransitionPeriod,
    inCompletionState,
    hasCompletedRef: hasCompletedRef.current,
    reachedFinalCount: reachedFinalCountRef.current,
    staticCompletionState: staticCompletionTracker.current,
    autoDismissSet: autoDismissSetTimeRef.current !== null,
    lastSessionCompletionTime: lastSessionCompletionTimeRef.current
  });

  // Function to set up auto-dismiss timer
  const scheduleAutoDismiss = (delay: number = 5000) => {
    console.log(`🕒 Setting up auto-dismiss timer for ${delay}ms`);
    
    // Record when we scheduled the auto-dismiss
    autoDismissSetTimeRef.current = Date.now();
    staticCompletionTracker.current.dismissScheduled = true;
    
    // Clear any existing timers
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
    
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    
    // Set new timer
    autoDismissTimerRef.current = setTimeout(() => {
      console.log("🏁 Auto-dismiss timer fired - dismissing notification");
      setIsDismissed(true);
      setShowCompletionMessage(false);
      autoDismissTimerRef.current = null;
      // Record completion time when notification is dismissed
      lastSessionCompletionTimeRef.current = Date.now();
    }, delay);
    
    // Set backup timer with additional delay
    completionTimerRef.current = setTimeout(() => {
      console.log("🏁 Backup auto-dismiss timer fired - forcing dismissal");
      if (!isDismissed) {
        setIsDismissed(true);
        setShowCompletionMessage(false);
        // Record completion time when notification is dismissed by backup
        lastSessionCompletionTimeRef.current = Date.now();
      }
    }, delay + 1000); // Add 1 second buffer
  };

  // Add a function to transition to completion state
  const transitionToCompletionState = () => {
    console.log("🔄 Explicitly calling transitionToCompletionState function");
    
    // Clear any stuck timer
    if (stuckAt100TimerRef.current) {
      clearTimeout(stuckAt100TimerRef.current);
      stuckAt100TimerRef.current = null;
    }
    
    // Clear manual override timer
    if (manualOverrideTimerRef.current) {
      clearTimeout(manualOverrideTimerRef.current);
      manualOverrideTimerRef.current = null;
    }
    
    stuck100StartTimeRef.current = null;
    
    console.log("🔄 Transition period over. Showing completion UI.");
    
    // Change the UI to show completion
    setShowInProgressUI(false);
    
    // Set completion state to true to prevent further updates
    setInCompletionState(true);
    
    // Start the completion sequence
    // Mark as completed to prevent multiple notifications
    hasCompletedRef.current = true;
    staticCompletionTracker.current = {
      ...staticCompletionTracker.current,
      hasShownCompletion: true,
      completionShownAt: Date.now(),
      dismissScheduled: false
    };
    
    // Show the completion message
    setShowCompletionMessage(true);
    
    // End transition period (completion visibility will now be managed by shouldForceDisplay)
    setInTransitionPeriod(false);
    
    // Schedule auto-dismiss
    scheduleAutoDismiss(5000);
    
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  };

  // Function to schedule transition - consolidates our transition scheduling logic
  const scheduleTransition = (delay: number = 1800) => {
    console.log(`⏱️ Scheduling transition in ${delay}ms`);
    
    // Record when we scheduled a transition
    lastTransitionScheduledTimeRef.current = Date.now();
    
    // Clear any existing transition timer
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    
    // Set the transition state to keep notification visible
    setInTransitionPeriod(true);
    
    // Schedule the actual transition
    transitionTimerRef.current = setTimeout(() => {
      console.log(`⏱️ Executing scheduled transition after ${delay}ms`);
      transitionToCompletionState();
    }, delay);
    
    // Set an aggressive backup timeout for 2 seconds in case our timer doesn't fire
    if (manualOverrideTimerRef.current) {
      clearTimeout(manualOverrideTimerRef.current);
    }
    
    manualOverrideTimerRef.current = setTimeout(() => {
      console.log("🚨 Manual override timer fired - forcing completion state");
      if (!inCompletionState && showInProgressUI) {
        transitionToCompletionState();
      }
      manualOverrideTimerRef.current = null;
    }, delay + 800); // Add extra time to ensure the normal timer has a chance
  };

  // Add a direct check to force auto-dismiss if notification has been visible for too long
  useEffect(() => {
    // If we're showing completion message but haven't set up auto-dismiss
    if (showCompletionMessage && !staticCompletionTracker.current.dismissScheduled) {
      console.log("🚨 Completion message showing but no auto-dismiss scheduled - fixing");
      scheduleAutoDismiss(5000);
    }
    
    // If we've been showing completion for too long (>6 seconds) without dismissing
    if (showCompletionMessage && staticCompletionTracker.current.completionShownAt) {
      const timeShowing = Date.now() - staticCompletionTracker.current.completionShownAt;
      if (timeShowing > 6000 && !isDismissed) {
        console.log("🚨 EMERGENCY: Completion message has been showing too long - forcing dismiss");
        setIsDismissed(true);
        // Record completion time for this emergency dismissal
        lastSessionCompletionTimeRef.current = Date.now();
      }
    }
  }, [showCompletionMessage, isDismissed]);

  // Set up a listener to force visibility during the completion message display period
  useEffect(() => {
    // If we just started showing completion message, schedule auto-dismiss
    if (showCompletionMessage && !staticCompletionTracker.current.dismissScheduled) {
      scheduleAutoDismiss(5000);
    }
    
    // If completion is shown and a timer exists, make sure isVisible doesn't get overridden
    if (showCompletionMessage && staticCompletionTracker.current.completionShownAt) {
      const elapsedTime = Date.now() - staticCompletionTracker.current.completionShownAt;
      const remainingTime = Math.max(0, 5000 - elapsedTime);
      
      console.log(`🕒 Completion message showing, ${remainingTime}ms remaining`);
      
      // If there's still time remaining, ensure visibility
      if (remainingTime > 0 && !forcedVisibilityTimerRef.current) {
        forcedVisibilityTimerRef.current = setTimeout(() => {
          console.log("⏰ Completion display time finished");
          forcedVisibilityTimerRef.current = null;
          
          // Double-check auto-dismiss
          if (!isDismissed && !autoDismissTimerRef.current) {
            console.log("⚠️ Display time finished but not dismissed - forcing dismiss");
            setIsDismissed(true);
            // Record completion time for this forced dismissal
            lastSessionCompletionTimeRef.current = Date.now();
          }
        }, remainingTime);
      }
    }
    
    return () => {
      if (forcedVisibilityTimerRef.current) {
        clearTimeout(forcedVisibilityTimerRef.current);
        forcedVisibilityTimerRef.current = null;
      }
    };
  }, [showCompletionMessage, isDismissed]);

  // Force a regular update to ensure UI stays fresh
  useEffect(() => {
    if ((isVisible || inTransitionPeriod) && !showCompletionMessage) {
      // Update every 500ms to ensure UI is current
      const intervalId = setInterval(() => {
        forceUpdate();
      }, 500);
      
      return () => clearInterval(intervalId);
    }
  }, [isVisible, inTransitionPeriod, showCompletionMessage]);

  // Immediate check if we're at the final cell to auto-transition
  useEffect(() => {
    // Check if we're showing the final cell (all cells complete)
    const isAtFinalCell = 
      localCompleted === totalCells && 
      totalCells > 0 && 
      showInProgressUI && 
      !inCompletionState;
    
    if (isAtFinalCell) {
      console.log("🎯 AUTO-DETECTED FINAL CELL STATE - scheduling transition");
      
      // Don't schedule if we've already set up a transition recently
      const now = Date.now();
      const timeSinceLastSchedule = lastTransitionScheduledTimeRef.current
        ? now - lastTransitionScheduledTimeRef.current
        : null;
        
      if (!timeSinceLastSchedule || timeSinceLastSchedule > 1000) {
        // Mark that we've reached the final count
        reachedFinalCountRef.current = true;
        
        // Set up a faster transition (800ms instead of 1200ms)
        scheduleTransition(800);
      }
    }
  }, [localCompleted, totalCells, showInProgressUI, inCompletionState]);

  // Direct check for completion state - if we're at 100%, immediately set up the transition
  useEffect(() => {
    // Check if we've reached exactly 100% (completed equals total)
    const isCompletePrecisely = completedCells === totalCells && totalCells > 0;
    
    if (isCompletePrecisely && !inCompletionState && !reachedFinalCountRef.current) {
      console.log("💯 Direct detection of 100% completion, initiating transition sequence");
      
      // Mark that we've reached the final count
      reachedFinalCountRef.current = true;
      
      // Schedule transition with standard delay
      scheduleTransition();
    }
  }, [completedCells, totalCells, inCompletionState]);

  // Add a check to detect when we're stuck at 100% for too long
  useEffect(() => {
    // Check if we're at 100% (all cells completed) but still in progress UI
    const isAt100Percent = completedCells >= totalCells && totalCells > 0 && showInProgressUI && !inCompletionState;
    
    if (isAt100Percent) {
      // If we just reached 100%, start the timer
      if (!stuck100StartTimeRef.current) {
        console.log("⚠️ Detected 100% completion but still in progress UI, starting stuck detection timer");
        stuck100StartTimeRef.current = Date.now();
        
        // Set a timer to force transition after being stuck for a short time
        if (stuckAt100TimerRef.current) {
          clearTimeout(stuckAt100TimerRef.current);
        }
        
        stuckAt100TimerRef.current = setTimeout(() => {
          console.log("🚨 Stuck at 100% for too long, forcing transition to completion");
          // Force transition to completion state
          transitionToCompletionState();
          stuckAt100TimerRef.current = null;
        }, 1000); // Shortened to just 1 second
      }
    } else {
      // If we're no longer at 100%, clear the timer
      if (stuck100StartTimeRef.current) {
        console.log("No longer at 100%, clearing stuck detection timer");
        stuck100StartTimeRef.current = null;
        
        if (stuckAt100TimerRef.current) {
          clearTimeout(stuckAt100TimerRef.current);
          stuckAt100TimerRef.current = null;
        }
      }
    }
    
    return () => {
      if (stuckAt100TimerRef.current) {
        clearTimeout(stuckAt100TimerRef.current);
        stuckAt100TimerRef.current = null;
      }
    };
  }, [completedCells, totalCells, showInProgressUI, inCompletionState]);

  // Handle the transition only once we reach the final cell count
  useEffect(() => {
    // Track the highest completed count we've seen to prevent going backward
    if (completedCells > highestCompletedRef.current) {
      highestCompletedRef.current = completedCells;
    }
    
    // Don't process state changes if we're already in the completion state
    if (inCompletionState) {
      console.log("🛑 Ignoring state updates because we're in completion state");
      return;
    }
    
    // Expand the condition to catch more completion scenarios
    const isAtOrAboveCompletion = completedCells >= totalCells && totalCells > 0 && completedCells > 0;
    
    // Enhanced logging to debug completion condition
    if (completedCells >= totalCells - 1 && totalCells > 0) {
      console.log("🔍 Completion condition check:", {
        isAtOrAboveCompletion,
        reachedFinalCountRef: reachedFinalCountRef.current,
        showCompletionMessage,
        completedCells,
        totalCells,
        inTransitionPeriod,
      });
    }
    
    // Trigger the transition if we're at or above completion threshold
    if (isAtOrAboveCompletion && !reachedFinalCountRef.current && !showCompletionMessage) {
      console.log("🎯 At or above completion threshold. Starting transition period.");
      
      // Mark that we've reached the final count to avoid duplicate transitions
      reachedFinalCountRef.current = true;
      
      // Schedule the transition
      scheduleTransition();
    }
  }, [completedCells, totalCells, showCompletionMessage, inCompletionState, inTransitionPeriod]);

  // Update local state whenever completedCells changes but separate from transition effects
  useEffect(() => {
    // Don't update if we're showing completion already or in completion state
    if (!showCompletionMessage && !inCompletionState) {
      // Set the local completed count based on completedCells
      if (completedCells >= stableTotalRef.current || completedCells >= totalCells) {
        // Show the total for exact completion
        setLocalCompleted(stableTotalRef.current > 0 ? stableTotalRef.current : totalCells);
        console.log("📊 Setting completed count to total:", stableTotalRef.current || totalCells);
      } else {
        // Otherwise, show the actual progress, never go below what we've already shown
        const stableValue = Math.max(
          highestCompletedRef.current, 
          Math.max(0, completedCells)
        );
        
        setLocalCompleted(stableValue);
        console.log("📊 Setting completed count to:", stableValue, 
          "(highest seen:", highestCompletedRef.current, ", current:", completedCells, ")");
        
        // Reset the final count flag if we're below total and not in transition
        if (reachedFinalCountRef.current && !inTransitionPeriod) {
          console.log("↩️ Resetting final count flag because we're back to in-progress");
          reachedFinalCountRef.current = false;
          setInTransitionPeriod(false);
        }
      }
    }
  }, [completedCells, totalCells, showCompletionMessage, inCompletionState, inTransitionPeriod]);

  // Add a special effect to detect new autocomplete sessions
  useEffect(() => {
    // When isVisible changes to true AND either:
    // 1. We have non-zero totalCells (indicating a new session starting)
    // 2. completedCells has been reset to 0
    // This likely means we're starting a new autocomplete session
    if (isVisible && totalCells > 0 && completedCells === 0) {
      // Check if this is a new session by checking if more than 2 seconds have passed since last completion
      const now = Date.now();
      const isNewSession = !lastSessionCompletionTimeRef.current || 
                           (now - lastSessionCompletionTimeRef.current > 2000);
      
      if (isNewSession) {
        console.log("🔔 Detected new autocomplete session starting - resetting all state");
        resetAllState();
      }
    }
  }, [isVisible, totalCells, completedCells]);

  // Create a new session when isVisible changes from false to true
  useEffect(() => {
    if (isVisible) {
      // Check if this is a new session and we're not in a completion or transition state
      const isPreExistingSession = hasCompletedRef.current || inCompletionState || inTransitionPeriod;
      
      if (!isPreExistingSession) {
        console.log("🔔 ProgressNotification became visible - creating new session");
        // Reset state for a new session
        resetAllState();
      } else if (hasCompletedRef.current && isDismissed) {
        // If we were previously dismissed but now visible again, likely means a new session
        console.log("🔔 New visibility after previous dismissal - creating new session");
        resetAllState();
      } else {
        console.log("🔔 ProgressNotification became visible but existing session detected");
      }
    } else {
      // When not visible, only reset if we're not in a transition, completion state, or showing completion
      if (!inTransitionPeriod && !showCompletionMessage && !inCompletionState) {
        console.log("⚪ ProgressNotification became invisible - resetting completion state");
        hasCompletedRef.current = false;
      } else {
        console.log("🔒 Not resetting state because we're in transition or completion", {
          inTransitionPeriod,
          showCompletionMessage,
          inCompletionState
        });
      }
    }
    
    // Cleanup function
    return () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      if (stuckAt100TimerRef.current) {
        clearTimeout(stuckAt100TimerRef.current);
        stuckAt100TimerRef.current = null;
      }
      if (manualOverrideTimerRef.current) {
        clearTimeout(manualOverrideTimerRef.current);
        manualOverrideTimerRef.current = null;
      }
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
        autoDismissTimerRef.current = null;
      }
    };
  }, [isVisible, inTransitionPeriod, showCompletionMessage, inCompletionState, isDismissed]);

  // Force transition if we detect we're at final stage too long
  useEffect(() => {
    // If we're at the final stage (Cell in progress: 5 of 5) for too long, force transition
    if (showInProgressUI && localCompleted === totalCells && totalCells > 0 && !inCompletionState) {
      console.log("🚨 FINAL FAIL-SAFE: Stuck at final cell UI state, forcing completion soon");
      
      // Use immediate timeout to ensure this runs ASAP
      setTimeout(() => {
        if (showInProgressUI && !inCompletionState) {
          console.log("🚨 EXECUTING FINAL FAIL-SAFE: Forcing transition to completion");
          transitionToCompletionState();
        }
      }, 1000);
    }
  }, [showInProgressUI, localCompleted, totalCells, inCompletionState]);

  // Add another check - if the notification was recently completed and dismissed,
  // don't show it again for 2 seconds (prevents flickering)
  const lastDismissTimeRef = useRef<number>(0);
  
  useEffect(() => {
    if (isDismissed) {
      lastDismissTimeRef.current = Date.now();
    }
  }, [isDismissed]);
  
  // Determine if we should force visibility during completion message display
  const shouldForceDisplay = (showCompletionMessage && 
    staticCompletionTracker.current.completionShownAt &&
    (Date.now() - staticCompletionTracker.current.completionShownAt < 5000)) || 
    inTransitionPeriod || 
    inCompletionState;
  
  // Check if we should display the notification based on all conditions
  // Include various flags to keep notification visible during critical phases
  if ((!isVisible && !shouldForceDisplay) || isDismissed) {
    console.log("❌ ProgressNotification not showing because:", { 
      isVisible, 
      shouldForceDisplay,
      inTransitionPeriod,
      inCompletionState,
      isDismissed 
    });
    return null;
  }
  
  // Add an additional check to prevent showing after recent completion
  const timeSinceLastDismiss = Date.now() - lastDismissTimeRef.current;
  if (staticCompletionTracker.current.hasShownCompletion && 
      !shouldForceDisplay && 
      timeSinceLastDismiss < 2000) {
    console.log("⏱️ Not showing notification - was recently completed and dismissed");
    return null;
  }

  // Always use a stable value for display that won't suddenly reset to 0
  const displayCompleted = inCompletionState 
    ? stableTotalRef.current 
    : localCompleted;
    
  const displayTotal = inCompletionState 
    ? stableTotalRef.current 
    : stableTotalRef.current || totalCells;

  // Calculate percentage directly from completed/total
  const progressPercent = displayTotal > 0 
    ? Math.round((displayCompleted / displayTotal) * 100) 
    : 0;
    
  // Calculate remaining cells
  const remainingCells = Math.max(0, displayTotal - displayCompleted);
  
  // Get a display name for the current cell that includes the book ID and formats the chapter:verse
  const currentCellName = currentCellId ? 
    (() => {
      const parts = currentCellId.split(" ");
      // Check if we have at least 2 parts (book and cell reference)
      if (parts.length >= 2) {
        const [book, cellRef] = [parts[0], parts[1]];
        // Format chapter:verse as chapter.verse if possible
        const formattedCellRef = cellRef?.split(":").join(".");
        return `${book} ${formattedCellRef}`;
      }
      // If the format is unexpected, just return the original ID
      return currentCellId;
    })() : 
    "next cell";

  return (
    <div className="progress-notification-container">
      <div className="progress-notification">
        <div className="progress-notification-header">
          <span className="progress-notification-title">
            <i className={`codicon ${showCompletionMessage ? "codicon-check" : "codicon-sparkle"}`}></i>
            {showCompletionMessage 
              ? "Translation Completed" 
              : isSingleCell 
                ? "Translating Cell" 
                : "Autocompleting Translation Cells"}
          </span>
          <button 
            className="progress-notification-close"
            onClick={() => setIsDismissed(true)}
            title="Dismiss"
          >
            <i className="codicon codicon-close"></i>
          </button>
        </div>
        <div className="progress-notification-content">
          <div className="progress-bar-container">
            <div 
              className="progress-bar" 
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
          <div className="progress-notification-details">
            <div className="progress-count">
              {/* Use showInProgressUI to control which UI to show */}
              {showInProgressUI ? (
                <>
                  Cell in progress: <strong>{displayCompleted}</strong> of <strong>{displayTotal}</strong>
                  {!showCompletionMessage && remainingCells > 0 && ` (${remainingCells} remaining)`}
                </>
              ) : (
                <>
                  <strong>{displayCompleted}</strong> of <strong>{displayTotal}</strong> completed!
                </>
              )}
            </div>
            <div className="progress-percentage">
              <strong>{progressPercent}%</strong>
            </div>
          </div>
          {!showCompletionMessage && (
            <div className="current-cell-status">
              <span className="processing-indicator"></span> Processing: <strong>{currentCellName}</strong>
            </div>
          )}
          {showCompletionMessage && (
            <div className="completion-message">
              Translation is complete! This message will dismiss automatically.
            </div>
          )}
        </div>
      </div>
      <style>{`
        .progress-notification-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .progress-notification {
          background-color: var(--vscode-notifications-background, #252526);
          color: var(--vscode-notifications-foreground, #cccccc);
          border: 1px solid var(--vscode-notifications-border, #454545);
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          width: 300px;
          overflow: hidden;
          animation: fadeIn 0.3s ease;
          font-family: var(--vscode-font-family);
          transition: background-color 0.2s ease;
        }
        
        .progress-notification:hover {
          background-color: var(--vscode-list-hoverBackground, #2a2d2e);
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .progress-notification-header {
          padding: 8px 12px;
          font-weight: 500;
          border-bottom: 1px solid var(--vscode-notifications-border, #454545);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .progress-notification-title {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
        }

        .progress-notification-title i {
          color: var(--vscode-focusBorder, #0e70c0);
        }
        
        .progress-notification-close {
          background: none;
          border: none;
          color: var(--vscode-icon-foreground, #cccccc);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.7;
          width: 22px;
          height: 22px;
          min-width: 22px;
          margin-left: 8px;
          border-radius: 3px;
        }
        
        .progress-notification-close:hover {
          opacity: 1;
          background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
        }

        .progress-notification-content {
          padding: 12px;
        }

        .progress-bar-container {
          width: 100%;
          height: 6px;
          background-color: var(--vscode-progressBar-background, #3c3c3c);
          border-radius: 2px;
          margin-bottom: 8px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease;
          background-color: var(--vscode-focusBorder, #0e70c0);
        }

        .progress-notification-details {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--vscode-descriptionForeground, #cccccc);
          margin-bottom: 6px;
        }
        
        .current-cell-status {
          font-size: 11px;
          color: var(--vscode-descriptionForeground, #cccccc);
          margin-top: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .completion-message {
          font-size: 11px;
          color: var(--vscode-descriptionForeground, #cccccc);
          margin-top: 4px;
          color: var(--vscode-notificationsInfoIcon-foreground, #75beff);
        }

        .processing-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: var(--vscode-statusBarItem-prominentBackground, #388a34);
          position: relative;
          animation: pulse 1s infinite;
        }
        
        @keyframes pulse {
          0% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(0.8);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export default ProgressNotification; 