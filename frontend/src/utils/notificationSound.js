let sharedAudioContext = null;

const getAudioContext = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextClass();
  }

  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {
      // Certains navigateurs bloquent la lecture auto avant interaction utilisateur.
    });
  }

  return sharedAudioContext;
};

const playToneSequence = (sequence) => {
  const audioContext = getAudioContext();
  if (!audioContext) {
    return false;
  }

  const now = audioContext.currentTime;

  sequence.forEach((tone) => {
    const start = now + (tone.delay || 0);
    const end = start + tone.duration;
    const gainValue = tone.gain || 0.12;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = tone.type || 'sine';
    oscillator.frequency.setValueAtTime(tone.frequency, start);

    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(start);
    oscillator.stop(end + 0.02);
  });

  return true;
};

export const playNotificationTone = (kind = 'default') => {
  if (kind === 'order-ready') {
    return playToneSequence([
      { frequency: 880, duration: 0.12, delay: 0.0, gain: 0.12 },
      { frequency: 1174, duration: 0.14, delay: 0.16, gain: 0.12 },
    ]);
  }

  if (kind === 'new-order') {
    return playToneSequence([
      { frequency: 587, duration: 0.11, delay: 0.0, gain: 0.11 },
      { frequency: 659, duration: 0.11, delay: 0.14, gain: 0.11 },
      { frequency: 783, duration: 0.14, delay: 0.28, gain: 0.11 },
    ]);
  }

  return playToneSequence([
    { frequency: 740, duration: 0.12, delay: 0.0, gain: 0.1 },
  ]);
};

