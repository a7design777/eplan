export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  VALHALLA_URL: string;
  VALHALLA_CLIENT_ID: string;
  OCM_API_KEY?: string;
  /**
   * Код запрошення. Поки він заданий, зареєструватись можна лише з ним —
   * так застосунок лишається приватним і не впирається у fair-use Valhalla.
   * Прибрати секрет = відкрити вільну реєстрацію.
   */
  INVITE_CODE?: string;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Waypoint extends LatLon {
  name?: string;
}

/** Точка полілінії маршруту з накопиченою дистанцією та висотою. */
export interface RoutePoint extends LatLon {
  /** Накопичена відстань від старту, км. */
  distanceKm: number;
  /** Висота над рівнем моря, м. null якщо профіль недоступний. */
  elevationM: number | null;
  /** Розрахункова швидкість на цьому сегменті, км/год. */
  speedKph: number;
}

/** `schuko` — побутова розетка 220 В (granny-кабель): повільно, але часто безкоштовно. */
export type ConnectorType = 'ccs' | 'chademo' | 'type2' | 'tesla' | 'schuko';

/** Точка кривої зарядки: до якого SoC діє яка потужність. */
export interface ChargeCurvePoint {
  socPct: number;
  powerKw: number;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  /** Корисна ємність батареї, кВт·год. */
  batteryKwh: number;
  /** Базове споживання при ~90 км/год у м'яку погоду, Вт·год/км. */
  baseConsumptionWhPerKm: number;
  maxDcPowerKw: number;
  maxAcPowerKw: number;
  connectors: ConnectorType[];
  /** Крива зарядки, відсортована за socPct за зростанням. */
  chargeCurve: ChargeCurvePoint[];
}

/**
 * Як платити на станції. Береться з UsageTypeID OpenChargeMap —
 * єдиного поля про оплату, що має сталу структуру.
 */
export type AccessType =
  | 'public'
  | 'pay_at_location'
  | 'membership'
  | 'notice_required'
  | 'customers_only'
  | 'restricted';

export interface Station {
  id: number;
  name: string;
  lat: number;
  lon: number;
  /** Максимальна потужність серед портів, кВт. */
  maxPowerKw: number;
  connectors: ConnectorType[];
  networkId: number | null;
  networkName: string | null;
  isFree: boolean;
  portCount: number;
  countryCode: string | null;
  address: string | null;
  /** Ціна дослівно з OCM: «0,59 €/kWh», «Free», «see app». null — невідомо. */
  usageCost: string | null;
  accessType: AccessType | null;
  /** Коли станцію востаннє підтверджували в OCM, unix-час. */
  lastVerified: number | null;
}

/**
 * Як користувач хоче їхати.
 * - `fewest_stops` — менше зупинок, але довших: заряджаємось високо і їдемо далі.
 * - `balanced` — компроміс за замовчуванням.
 * - `short_stops` — часті короткі зупинки в найшвидшій частині кривої зарядки;
 *   сумарно зазвичай швидше, але вимагає щільної мережі станцій.
 */
export type ChargingStrategy = 'fewest_stops' | 'balanced' | 'short_stops';

export interface PlanFilters {
  /** Мережі, яким віддаємо перевагу при однаковій зручності. */
  preferredNetworkIds: number[];
  chargingStrategy: ChargingStrategy;
  /** Прийнятні типи конекторів. Порожньо = будь-який з тих, що є в авто. */
  connectors: ConnectorType[];
  /** id мереж, які не використовувати. */
  excludedNetworkIds: number[];
  /** Тільки безкоштовні зарядки. */
  freeOnly: boolean;
  /** Мінімальна потужність зарядки, кВт. */
  minPowerKw: number;
  /** Резерв заряду, нижче якого не опускатись, %. */
  reserveSocPct: number;
  /** Максимальний об'їзд до зарядки від маршруту, км. */
  maxDetourKm: number;
  avoidTolls: boolean;
  /** Зовнішня температура, °C — впливає і на споживання, і на швидкість зарядки. */
  temperatureC: number;
  /** Брати реальну температуру з прогнозу замість заданої вручну. */
  useLiveWeather: boolean;
}

export interface PlanRequest {
  waypoints: Waypoint[];
  vehicle: Vehicle;
  startSocPct: number;
  targetSocPct: number;
  filters: PlanFilters;
  /**
   * Станції, які користувач сам обрав на мапі. Планувальник зобов'язаний
   * зупинитись саме на них, а проміжки за потреби добере автоматично.
   */
  forcedStationIds: number[];
}

export interface ChargeStop {
  station: Station;
  /** Позиція вздовж маршруту, км від старту. */
  distanceKm: number;
  arrivalSocPct: number;
  departureSocPct: number;
  /** Час зарядки без урахування під'їзду, хв. */
  chargeDurationMin: number;
  /** Повний час зупинки з під'їздом і підключенням, хв. */
  totalStopMin: number;
  energyAddedKwh: number;
  /** Об'їзд від маршруту в один бік, км. */
  detourKm: number;
  /** Середня потужність за час зарядки, кВт. */
  averagePowerKw: number;
  /** Вартість зупинки. null — ціна станції невідома. */
  cost: { amount: number; currency: string } | null;
  /** Попередження саме про цю станцію: мало портів, давно не підтверджували. */
  cautions: string[];
}

export interface TollInfo {
  hasTolls: boolean;
  /** Коди країн, у яких маршрут проходить платними ділянками. */
  countries: string[];
  /** Приблизна довжина платних ділянок, км. */
  tollDistanceKm: number;
}

export interface RoutePlan {
  waypoints: Waypoint[];
  stops: ChargeStop[];
  /** Полілінія у форматі GeoJSON-координат [lon, lat]. */
  geometry: [number, number][];
  totalDistanceKm: number;
  drivingDurationMin: number;
  chargingDurationMin: number;
  totalDurationMin: number;
  /** Заряд на фініші, %. null — якщо маршрут непроїзний і фініш недосяжний. */
  arrivalSocPct: number | null;
  totalEnergyKwh: number;
  /** Орієнтовна вартість зарядок. null — цін не знайшлось. */
  cost: { total: number; currency: string; unknownStops: number } | null;
  tolls: TollInfo;
  /** true якщо маршрут неможливо проїхати з наявними зарядками. */
  unreachable: boolean;
  warnings: string[];
  /**
   * Інші станції в коридорі маршруту — щоб показати їх на мапі як варіанти
   * заміни. Обмежені кількістю: уся вибірка може бути в тисячі точок.
   */
  nearbyStations: NearbyStation[];
}

export interface NearbyStation {
  station: Station;
  /** Позиція вздовж маршруту, км від старту. */
  distanceKm: number;
  detourKm: number;
}

export interface PlanResponse {
  primary: RoutePlan;
  /** Альтернатива без платних доріг, якщо основний маршрут платний. */
  tollFree: RoutePlan | null;
  /** Інші варіанти проїзду від рушія — інші дороги, не інші зарядки. */
  alternatives: RoutePlan[];
  /** Температура, з якою реально рахували: або задана, або з прогнозу. */
  temperatureC: number;
}
