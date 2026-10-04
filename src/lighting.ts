import * as THREE from 'three';

export type Mood = 'dusk' | 'indoor';

/**
 * Lights for the toon meshes (doors, props, hands) so they sit in the painted splat lighting.
 * The splats carry their own baked light and ignore these.
 */
export class MoodLights extends THREE.Group {
  private readonly hemi = new THREE.HemisphereLight();
  private readonly key = new THREE.DirectionalLight();
  private readonly rim = new THREE.DirectionalLight();

  constructor(mood: Mood = 'dusk') {
    super();
    this.key.position.set(0.6, 1, 0.4);
    this.rim.position.set(-0.8, 0.5, -1);
    this.add(this.hemi, this.key, this.rim);
    this.setMood(mood);
  }

  setMood(mood: Mood) {
    if (mood === 'dusk') {
      this.hemi.color.set(0x8f9cbc); // overcast sky
      this.hemi.groundColor.set(0x3a2c30);
      this.hemi.intensity = 0.55;
      this.key.color.set(0xffbf8f); // the porch lantern
      this.key.intensity = 1.35;
      this.rim.color.set(0x3fc3b8);
      this.rim.intensity = 0.7;
    } else {
      this.hemi.color.set(0xd9a878);
      this.hemi.groundColor.set(0x3a2418);
      this.hemi.intensity = 0.6;
      this.key.color.set(0xffa766); // lamps and firelight
      this.key.intensity = 1.4;
      this.rim.color.set(0x5ec8ff); // window light
      this.rim.intensity = 0.45;
    }
  }
}
