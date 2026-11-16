(() => {
  const dictionary = (text, bilingual = false) => new Map(text.trim().split("\n").map(line => {
    const [key, ...values] = line.split("|");
    return [key, bilingual ? values : values[0]];
  }));
  const equipment = dictionary(`
HSABC|Abdominal|Abdominal Crunch
HSADC|Fondos y dominadas asistidos|Assisted Dip & Chin
HSBE|Extensión de espalda|Back Extension
HSBC|Curl de bíceps|Biceps Curl
HSCP|Press de pecho|Chest Press
HSFPD|Jalón fijo|Fixed Pulldown
PLHSQ|Sentadilla hack|Hack Squat
HSHAB|Abducción de cadera|Hip Abduction
HSHAD|Aducción de cadera|Hip Adduction
HSHG|Glúteos y cadera|Hip & Glute
HSPD|Jalón dorsal|Lat Pulldown
HSLC|Curl de piernas acostado|Leg Curl
HSLE|Extensión de piernas|Leg Extension
HSLLP|Prensa lineal de piernas|Linear Leg Press
HSFLY|Aperturas de pecho y deltoides posteriores|Pectoral Fly / Rear Deltoid
HSSLC|Curl de piernas sentado|Seated Leg Curl
HSSLP|Prensa de piernas sentada|Seated Leg Press
HSRW|Remo sentado|Seated Row
HSSP|Press de hombros|Shoulder Press
HSTE|Extensión de tríceps|Triceps Extension
CMDAP|Polea doble regulable|Dual Adjustable Pulley
MJ4|Multiestación de cuatro puestos|4-Station Multi-Jungle
SSM|Máquina Smith|Smith Machine
SSAB|Abdominal|Abdominal
SSHAB|Abducción de cadera|Hip Abduction
SSHAD|Aducción de cadera|Hip Adduction
SUB|Banco de 90°|Utility Bench
SADB|Banco declinado ajustable|Adjustable Decline/Abdominal Bench
SMAB|Banco ajustable|Multi-Adjustable Bench
SLR|Banco para elevación de piernas|Leg Raise Bench
SBE|Banco de hiperextensión|Back Extension Bench
SOIB|Banco inclinado olímpico|Olympic Incline Bench
SOFB|Banco plano olímpico|Olympic Flat Bench
SFB|Banco plano|Flat Bench
SAC|Banco predicador|Arm Curl Bench
ICLFIC5B201|Bicicleta de spinning|Indoor Cycle IC5
ICLFIC7B201|Bicicleta de spinning|Indoor Cycle IC7
INR|Bicicleta horizontal|Recumbent Bike
INC|Bicicleta vertical|Upright Bike
SSBC|Curl de bíceps|Biceps Curl
SSLC2098579X|Curl de piernas acostado|Leg Curl
SSSLC|Curl de piernas sentado|Seated Leg Curl
DCP95PS|Escaladora PowerMill|PowerMill Climber
SSBE|Extensión de espalda|Back Extension
PLGLD|Empuje de cadera con discos|Plate Loaded Glute Drive
SSGL|Glúteos|Glute
SSLE|Extensión de piernas|Leg Extension
SSPD|Jalón dorsal|Pulldown
SPLCALF|Elevación de pantorrillas con discos|Plate Loaded Calf Raise
SSCE|Extensión de pantorrillas|Calf Extension
SSFLY|Aperturas de pecho y deltoides posteriores|Pectoral Fly / Rear Deltoid
CMACO|Cruce de poleas regulable|Adjustable Cable Crossover
SPLLLP|Prensa lineal de piernas|Linear Leg Press
SSSP|Press de hombros|Shoulder Press
SSCP|Press de pecho|Chest Press
SSSLP|Prensa de piernas sentada|Seated Leg Press
SSTP|Press de tríceps|Triceps Press
SOSR|Soporte olímpico para sentadillas|Olympic Squat Rack
SSRW|Remo|Row
INTTRD|Trotadora Integrity SL|Integrity SL Treadmill
T600XSF|Trotadora|Treadmill
EESF|Elíptica|Elliptical
RTG2|Trotadora|Treadmill
`, true);

  const sections = dictionary(`
MACHINE|Equipo
ABDUCTION|Abducción
ASSIST DIP CHIN|Fondos y dominadas asistidos
ADJUSTABLE DECLINE/ABDOMINAL|Banco declinado ajustable
SMAB-003 MULTI ADJUSTABLE BENCH|Banco ajustable SMAB-003
SMAB-003 SIGNATURE MULTI ADJUSTABLE BENCH|Banco ajustable Signature SMAB-003
EXTENSION|Extensión
INCLINE BENCH|Banco inclinado
FLAT BENCH|Banco plano
IC5 BASE/CONSOLE, LF BRND|Base y consola Life Fitness IC5
IC7 BASE/CONSOLE, LF BRND|Base y consola Life Fitness IC7
CURL|Flexión
ACCESSORY TRAYS & HANDLEBAR COVERS|Bandejas para accesorios y cubiertas del manillar
LOADED GLUTE DRIVE|Empuje de cadera con discos
PULLDOWN|Jalón dorsal
RAISE|Elevación
DELTOID|Deltoides
CROSSOVER|Cruce de poleas
PRESS|Press
SQUAT RACK|Soporte para sentadillas
POWDER COATED COMPONENTS|Piezas pintadas
COMPONENT|Componentes
COMPONENT ASSEMBLY LEGEND|Leyenda del conjunto principal
COMPONENT ASSEMBLY TABLE|Tabla del conjunto principal
COMPONENT ASSEMBLY|Conjunto principal
LEFT SIDE FRAME|Bastidor lateral izquierdo
RIGHT SIDE FRAME|Bastidor lateral derecho
SIDE FRAME|Bastidor lateral
CARRIAGE|Carro
CHIN BAR|Barra de dominadas
WEIGHT STACK|Pila de pesas
390 LB. WEIGHT STACK|Pila de pesas de 390 lb
INCREMENT WEIGHT|Peso incremental
ADD-ON WEIGHT|Peso adicional
ADD-ON INC. WEIGHT COMPONENTS|Componentes del peso incremental adicional
REAR SHROUD|Cubierta trasera
FULL SHROUD|Cubierta completa
STACK FRAME|Bastidor de la pila de pesas
MOVEMENT ARM|Brazo móvil
SE MOVEMENT ARM|Brazo móvil SE
SE MOVEMENT ARM CAM|Leva del brazo móvil SE
SE MOVEMENT ARM ADJUST|Ajuste del brazo móvil SE
SE MOVEMENT ARM SHIFTER|Selector del brazo móvil SE
SEAT FRAME|Bastidor del asiento
TOWER|Torre
TOWER ASSEMBLY TABLE|Tabla del conjunto de la torre
BASE TRIM|Versión Base
WORKBOX|Caja del mecanismo
ADJUSTMENT ARM|Brazo de ajuste
HEAD PLATE STOP|Tope de la placa superior
CONNECTING HARDWARE|Elementos de fijación
PAINTED WELDMENTS|Conjuntos soldados pintados
ADJ. PULLEY COLUMN|Columna de polea regulable
CHIN SUPPORT|Soporte de dominadas
REAR SUPPORT|Soporte trasero
STACK PULLEY|Polea de la pila de pesas
STACK PULLEY ASSEMBLY SERIAL NUMBER CMDAP0512129 AND BELOW|Conjunto de polea de la pila hasta el número de serie CMDAP0512129
ACCESSORIES|Accesorios
LONG BAR|Barra larga
SPORT BAR|Barra deportiva
TRAINING AIDES|Accesorios de entrenamiento
OPTIONAL FRONT SHROUD KIT|Kit opcional de cubierta delantera
OPTIONAL SHROUD STACK WRAPS|Revestimientos opcionales para la pila de pesas
RIGHT HAND SIDE|Lado derecho
WORK ARM|Brazo de trabajo
LEFT WORK ARM|Brazo de trabajo izquierdo
RIGHT WORK ARM|Brazo de trabajo derecho
HARDWARE KIT|Kit de fijaciones
RANGE LIMITER|Limitador de recorrido
REAR UPRIGHT|Montante trasero
WEIGHT HORN|Soporte para discos
DRIVE PULLEY|Polea motriz
LINEAR BEARING|Rodamiento lineal
THIGH HOLD DOWN|Sujeción de muslos
THIGH HOLD-DOWN|Sujeción de muslos
LAT BAR|Barra de jalón dorsal
BASE MOVEMENT ARM|Brazo móvil Base
ROLLER SEAT|Asiento con rodillos
ST-5 SEAT|Asiento ST-5
UPHOLSTERY PADS|Almohadillas tapizadas
WELDMENT LIST LEGEND|Leyenda de conjuntos soldados
IMAGE|Imagen
ADJUSTABLE PULLEY CARRIAGE|Carro de polea regulable
ADJUSTABLE PULLEY COLUMN|Columna de polea regulable
ADJUSTABLE PULLEY COMPONENT|Componentes de polea regulable
BASE SUPPORT|Soporte de la base
DUAL PULLEY PULLDOWN BENCH|Banco de jalón de polea doble
DUAL PULLEY PULLDOWN BOOM|Brazo superior de jalón de polea doble
DUAL PULLEY PULLDOWN COMPONENT|Componentes de jalón de polea doble
DUAL PULLEY ROW BENCH|Banco de remo de polea doble
DUAL PULLEY ROW BOOM|Brazo superior de remo de polea doble
DUAL PULLEY ROW COMPONENT|Componentes de remo de polea doble
HANDLE ACCESSORY RACK COMPONENT|Componentes del soporte de accesorios
HOLD DOWN|Sujeción
INSTALLATION|Instalación
LAT PULL DOWN BENCH|Banco de jalón dorsal
LAT PULL DOWN COMPONENT|Componentes de jalón dorsal
ADJUSTABLE CROSSOVER COMPONENT|Componentes de cruce de poleas regulable
ADJUSTABLE CROSSOVER BOOM|Brazo superior de cruce de poleas regulable
FIXED CROSSOVER BOOM|Brazo superior de cruce de poleas fijo
FIXED CROSSOVER COMPONENT|Componentes de cruce de poleas fijo
FIXED CROSSOVER OVER BOTTOM|Conjunto inferior de cruce de poleas fijo
BOOM|Brazo superior
ROW BENCH|Banco de remo
ROW BOOM|Brazo superior de remo
ROW COMPONENT|Componentes de remo
SWIVEL PULLEY|Polea giratoria
TRICEPS PUSHDOWN COMPONENT|Componentes de extensión de tríceps en polea
X-BEAM|Travesaño en X
A INSIGNIA OPTIONS LEGEND|Leyenda A de opciones Insignia
A LEGEND DESCRIPTION|Descripción de la leyenda A
BASE|Base
BASE ELECTRONICS|Electrónica de la base
BASE FRAME ELECTRONICS|Electrónica del bastidor base
BASE FRAME|Bastidor base
BASEFRAME|Bastidor base
BASE P-STACK|Pila de pesas P de la versión Base
BASE T-STACK|Pila de pesas T de la versión Base
BASE T-STACK HEAD PLATE|Placa superior de la pila T de la versión Base
BATTERY|Batería
BENCH|Banco
BENCH FRAME|Bastidor del banco
BOSU BALL|Pelota BOSU
BOTTOM CAM|Leva inferior
BRIDGE - SHROUDS|Cubiertas del puente
BRIDGE, UPRIGHTS AND GROUNDING BRAID CABLES|Puente, montantes y cables trenzados de tierra
BULLHORNS|Manillares curvos
C AND X HEAD PLATE|Placa superior de las pilas C y X
C AND X INCREMENT WEIGHTS|Pesos incrementales de las pilas C y X
PREVIOUS C AND X INCREMENT WEIGHT|Peso incremental anterior de las pilas C y X
PREVIOUS C AND X INCREMENT WEIGHTS|Pesos incrementales anteriores de las pilas C y X
CABLE|Cable
CABLES|Cables
CAM|Leva
CHEST SUPPORT|Apoyo de pecho
COMMUNICATION PORT, PLUGS & PCB|Puerto de comunicación, conectores y placa electrónica
CONSOLE - REAR SHROUDS|Cubiertas traseras de la consola
CONSOLE COVER & CUP HOLDERS|Cubierta de consola y portavasos
CUP HOLDERS & SEAT BOTTOM|Portavasos y base del asiento
CUSTOM|Personalizado
DECK, RAILS AND END CAPS|Plataforma, rieles y tapas terminales
DRIVE MOTOR, PULLEY AND ROLLERS|Motor de tracción, polea y rodillos
DRIVE SYSTEM|Sistema de tracción
DRIVETRAIN|Transmisión
FINISHED GOOD SKU ALPHA CODE /|Códigos alfanuméricos de producto terminado
FRAME AND UPHOLSTERY COLOR CHART|Tabla de colores del bastidor y tapizado
FRAME AND UPHOLSTERY COLORS|Colores del bastidor y tapizado
FRAME COMPONENTS|Componentes del bastidor
FRAME PAINTED ITEMS|Piezas pintadas del bastidor
FRONT ROLLER & LEG LEVELERS|Rodillo delantero y niveladores
GRIPS|Empuñaduras
HANDLEBARS & CONSOLE SUPPORT|Manillares y soporte de consola
HEAVY X-STACK|Pila de pesas X pesada
LIGHT C-STACK|Pila de pesas C liviana
INTEGRITY SL CONSOLE|Consola Integrity SL
LABELS AND PLACARDS|Etiquetas y placas
LEFT ARM|Brazo izquierdo
LEFT FRAME|Bastidor izquierdo
RIGHT FRAME|Bastidor derecho
LEG LEVELERS & WHEELS|Niveladores y ruedas
LEG LEVELERS, FRONT ROLLER AND PCB RESISTANCE CONTROL|Niveladores, rodillo delantero y placa de control de resistencia
LIFT|Elevación
LIFT FRAME, LEG LEVELERS AND WHEELS|Bastidor de elevación, niveladores y ruedas
LOWER BASE WIRING|Cableado inferior de la base
MAIN FRAME|Bastidor principal
MISCELLANEOUS|Piezas varias
MONOCOLUMN|Columna central
MOTOR & BRAKE|Motor y freno
P-STACK HEAD PLATE|Placa superior de la pila P
P-STACK INCREMENT WEIGHT|Peso incremental de la pila P
PADS|Almohadillas
PADS AND CONNECTING HARDWARE|Almohadillas y fijaciones
PAINTED FRAME WELDMENTS - NO WEIGHT HORNS|Bastidor pintado sin soportes para discos
PAINTED FRAME WELDMENTS - WITH WEIGHT HORNS|Bastidor pintado con soportes para discos
PEDALS & MISCELLANEOUS|Pedales y piezas varias
PEDALS AND CRANK ARMS|Pedales y bielas
POWER CORDS|Cables de alimentación
REAR|Parte trasera
RIGHT ARM|Brazo derecho
ROLLER|Rodillo
S AND E TRIM TOWER TOP|Parte superior de la torre, versiones S y E
S, L AND E TRIMS|Versiones S, L y E
S, L AND E TRIMS TOWER TOP|Parte superior de la torre, versiones S, L y E
SEAT|Asiento
SEAT AND SEAT POST|Asiento y tija
SEAT CARRIAGE|Carro del asiento
SEAT HANDLE|Asa del asiento
SEAT RAIL|Riel del asiento
SERVICE WHEEL|Rueda de servicio
SHROUD WRAPS|Revestimientos de la cubierta
SHROUD, FULL|Cubierta completa
SHROUD, REAR - BEFORE DECEMBER 2024|Cubierta trasera anterior a diciembre de 2024
SIMPLE UPRIGHT ASSEMBLIES|Conjuntos de montantes simples
STEP ASSISTS|Ayudas de acceso
STEP SYSTEM|Sistema de peldaños
T TRIM LIFE FITNESS CONNECT|Versión T con Life Fitness Connect
THIGH HOLD|Sujeción de muslos
TOWER TOP|Parte superior de la torre
TOWER TOP TRIM|Acabado superior de la torre
UPPER BASE WITH INTEGRITY CONSOLE WIRING|Base superior con cableado para consola Integrity
UPPER SHROUDS AND MONOCOLUMN|Cubiertas superiores y columna central
WIRING DIAGRAM - BASE|Diagrama de cableado de la base
WIRING DIAGRAM - CONSOLE - DISCOVER|Diagrama de cableado de consola Discover
WIRING DIAGRAM - DISCOVER CONSOLE|Diagrama de cableado de consola Discover
WIRING DIAGRAM - CONSOLE - INTEGRITY X / INTEGRITY C|Diagrama de cableado de consolas Integrity X y C
WIRING DIAGRAM - INTEGRITY X & C CONSOLES|Diagrama de cableado de consolas Integrity X y C
WIRING DIAGRAM - INTEGRITY X AND C CONSOLES|Diagrama de cableado de consolas Integrity X y C
`);

  const existing = dictionary(`
VISTA GENERAL|General View
DESPIECE COMPLETO|Exploded View
PIEZAS PINTADAS|Powder Coated Components
COMPONENTES CON PINTURA EN POLVO|Powder Coated Components
CONJUNTO PRINCIPAL|Component Assembly
PILA DE PESAS|Weight Stack
CONJUNTO DE LA PILA DE PESAS|Weight Stack Assembly
PESO INCREMENTAL|Increment Weight
PESO ADICIONAL|Add-On Weight
CUBIERTA TRASERA|Rear Shroud
CUBIERTA COMPLETA|Full Shroud
CONJUNTO DE PESO INCREMENTAL (SE)|Increment Weight Assembly (SE)
CONJUNTO DE PESO ADICIONAL (BASE)|Add-On Weight Assembly (Base)
CONJUNTO DE CUBIERTA TRASERA|Rear Shroud Assembly
CONJUNTO DE CUBIERTA COMPLETA|Full Shroud Assembly
MONTAJE GENERAL|General Assembly
ADHESIVOS|Stickers
CHASIS|Chassis
CONSOLA|Console
MÓDULO ELECTRÓNICO|Electronic Module
INCLINACIÓN|Incline
SISTEMA DE INCLINACIÓN|Incline System
SISTEMA SAC|SAC System
APOYABRAZOS IZQUIERDO|Left Armrest
APOYABRAZOS DERECHO|Right Armrest
CONJUNTO DEL RODILLO TENSOR|Tension Roller Assembly
BASTIDOR|Frame
SENSOR DE PULSO|Pulse Sensor
`);

  const ellipticalSections = dictionary(`
SIDE COVER SET|Conjunto de cubiertas laterales
LINK ARM SET|Conjunto de brazos de enlace
CONSOLE MAST SET|Conjunto del mástil de la consola
ARM REST SET|Conjunto de apoyabrazos
SWING ARM SET|Conjunto del brazo oscilante
`);

  function translate(title) {
    let key = title.toUpperCase().replace(/_{2,}/g, "").replace(/\s+/g, " ").trim();
    key = key.replace("UPHOLSTER Y", "UPHOLSTERY");
    const prefix = key.match(/^(CMDAP|PL-HSQ|MJ[A-Z]+(?:\/AXO)?)\b\s*/)?.[0] || "";
    key = key.slice(prefix.length);
    const suffix = key.match(/ (\((?:CURRENT|PREVIOUS|CONTINUED|\d OF \d|\d INCH GRIP|[A-Z ,]+)\)|\d|BASE TRIM)$/)?.[0] || "";
    if (suffix && key !== "BASE TRIM") key = key.slice(0, -suffix.length);
    const assembly = / (?:ASSEMBLY|ASSY)$/.test(key);
    let translated = sections.get(key);
    if (!translated && assembly) {
      const component = sections.get(key.replace(/ (?:ASSEMBLY|ASSY)$/, ""));
      if (component) translated = "Conjunto · " + component;
    }
    if (!translated && prefix.trim() === key && assembly) translated = "Conjunto";
    if (!translated && key === "ASSEMBLY") translated = "Conjunto";
    if (!translated) return "";
    const qualifier = key === "BASE TRIM" ? "" : suffix.trim()
      .replace("CURRENT", "actual").replace("PREVIOUS", "anterior").replace("CONTINUED", "continuación")
      .replace(/(\d) OF (\d)/, "$1 de $2").replace(/(\d) INCH GRIP/, "empuñadura de $1 pulgadas")
      .replace("BASE TRIM", "· Versión Base");
    return [translated, prefix.trim(), qualifier].filter(Boolean).join(" ");
  }

  window.catalogEquipmentName = model => {
    const key = model.model.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const [es, en] = equipment.get(key) || [model.name, ""];
    return { es, en };
  };

  window.catalogViewName = (view, heading = false) => {
    const label = heading ? view.title : view.label;
    if (/^p\d+$/.test(view.id)) {
      if (/^Página \d+$/.test(view.title)) return { es: view.title, en: "Page " + view.label };
      const es = translate(view.title) || "Página " + view.label;
      return { es: heading ? es : view.label + " · " + es.replace(/^Página \d+$/, "Plano y referencias"), en: view.title };
    }
    if (heading) {
      const match = label.match(/^Conjunto (.+) · ([a-z][a-z ]+ set)$/i);
      const translated = match && ellipticalSections.get(match[2].toUpperCase());
      if (translated) return { es: `${translated} · ${match[1]}`, en: match[2] };
    }
    const key = label.toUpperCase();
    let en = existing.get(key) || "";
    if (/^Chasis RT /i.test(label)) en = label.replace(/^Chasis/i, "Chassis");
    if (/^CABLE(?:S|ADO) /i.test(label)) en = label.replace(/^Cables|^Cableado/i, "Wiring").replace(/con inclinación/i, "with incline");
    if (/^Conjunto \d|^Conjunto [A-Z]{2}/.test(label)) en = label.replace(/^Conjunto/, "Assembly");
    if (!heading && !en && /^\d|^[A-Z]{2}\d/.test(label)) return { es: "Vista " + label, en: "View " + label };
    return { es: label, en };
  };
})();
