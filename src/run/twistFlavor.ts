export function twistFlavor(id: string): string {
  switch (id) {
    case 'lights_out':
      return 'Someone tripped the breaker. Stick to the dark.';
    case 'short_cord':
      return 'The cord shrank in the wash. Stay close.';
    case 'slippery_floor':
      return 'Fresh wax everywhere. Brake early.';
    case 'nervous_nee':
      return 'NEE had three coffees. Keep her calm.';
    case 'rush_hour':
      return 'Late shift traffic. More eyes, less time.';
    default:
      return 'Something feels off tonight.';
  }
}
