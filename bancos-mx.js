/* ============================================================
   ETAAX — Bancos de México y CLABE interbancaria

   Fuente ÚNICA para los dos editores de colaborador (el inline de
   administrativo/staff.html y el flotante de staff-modal.js). Antes de
   agregar la lista a un tercer lugar: delegar aquí, no copiar.

   API (window.BancosMX):
     .lista                → [{ codigo, nombre }]  ordenada por nombre
     .nombrePorCodigo(c)   → 'BBVA México' | ''
     .bancoDeClabe(clabe)  → { codigo, nombre } | null   (los 3 primeros dígitos)
     .validarClabe(clabe)  → { ok, motivo, digitos }
     .formatearClabe(s)    → '012 180 01234567890 1'  (solo para mostrar)
   ============================================================ */
(function () {
    /* Códigos de 3 dígitos del catálogo de Banxico. La lista NO pretende ser
       completa —el catálogo cambia y hay decenas de entidades que ninguna nómina
       de restaurante va a usar— por eso el formulario siempre ofrece "Otro…".
       Alcance: los bancos comerciales que sí aparecen en una nómina, más las
       fintech que la gente ya usa para cobrar (Nu, Mercado Pago, Spin, Klar). */
    var BANCOS = [
        { codigo: '002', nombre: 'Banamex' },
        { codigo: '006', nombre: 'Bancomext' },
        { codigo: '009', nombre: 'Banobras' },
        { codigo: '012', nombre: 'BBVA México' },
        { codigo: '014', nombre: 'Santander' },
        { codigo: '019', nombre: 'Banjército' },
        { codigo: '021', nombre: 'HSBC' },
        { codigo: '030', nombre: 'Banco del Bajío' },
        { codigo: '036', nombre: 'Inbursa' },
        { codigo: '042', nombre: 'Mifel' },
        { codigo: '044', nombre: 'Scotiabank' },
        { codigo: '058', nombre: 'Banregio' },
        { codigo: '059', nombre: 'Invex' },
        { codigo: '060', nombre: 'Bansi' },
        { codigo: '062', nombre: 'Afirme' },
        { codigo: '072', nombre: 'Banorte' },
        { codigo: '112', nombre: 'BMonex' },
        { codigo: '113', nombre: 'Ve por Más' },
        { codigo: '127', nombre: 'Banco Azteca' },
        { codigo: '128', nombre: 'Autofin' },
        { codigo: '130', nombre: 'Compartamos Banco' },
        { codigo: '132', nombre: 'Multiva' },
        { codigo: '133', nombre: 'Actinver' },
        { codigo: '136', nombre: 'Intercam Banco' },
        { codigo: '137', nombre: 'BanCoppel' },
        { codigo: '140', nombre: 'Consubanco' },
        { codigo: '141', nombre: 'Volkswagen Bank' },
        { codigo: '143', nombre: 'CIBanco' },
        { codigo: '145', nombre: 'BBase' },
        { codigo: '166', nombre: 'Banco del Bienestar' },
        { codigo: '638', nombre: 'Nu México' },
        { codigo: '646', nombre: 'STP' },
        { codigo: '652', nombre: 'Credicapital' },
        { codigo: '661', nombre: 'Alternativos' },
        { codigo: '670', nombre: 'Libertad Servicios Financieros' },
        { codigo: '677', nombre: 'Caja Popular Mexicana' },
        { codigo: '710', nombre: 'NVIO' },
        { codigo: '722', nombre: 'Mercado Pago' },
        { codigo: '723', nombre: 'Cuenca' },
        { codigo: '728', nombre: 'Spin by OXXO' },
        { codigo: '812', nombre: 'Klar' }
    ];

    function _soloDigitos(s) { return String(s == null ? '' : s).replace(/[^0-9]/g, ''); }

    function nombrePorCodigo(codigo) {
        var c = _soloDigitos(codigo);
        for (var i = 0; i < BANCOS.length; i++) if (BANCOS[i].codigo === c) return BANCOS[i].nombre;
        return '';
    }

    /* Los 3 primeros dígitos de la CLABE SON el banco. Sirve para adelantarle el
       dato a quien captura, pero como sugerencia: si el código no está en la
       lista se devuelve null y no se adivina nada. Un banco mal puesto en un
       recibo de nómina es un problema con una persona, no un detalle cosmético. */
    function bancoDeClabe(clabe) {
        var d = _soloDigitos(clabe);
        if (d.length < 3) return null;
        var nom = nombrePorCodigo(d.slice(0, 3));
        return nom ? { codigo: d.slice(0, 3), nombre: nom } : null;
    }

    /* Dígito de control de la CLABE (norma Banxico): se pondera cada uno de los
       17 primeros dígitos con 3, 7, 1 (repitiendo), se toma cada producto MÓDULO
       10, se suman, y el control es (10 − suma%10) % 10.
       Esto no es cosmético: una CLABE con un dígito cambiado suele pasar como
       "18 dígitos" y el banco la rebota o —peor— cae en otra cuenta. */
    function digitoControl(primeros17) {
        var pesos = [3, 7, 1], suma = 0;
        for (var i = 0; i < 17; i++) {
            suma += (parseInt(primeros17.charAt(i), 10) * pesos[i % 3]) % 10;
        }
        return (10 - (suma % 10)) % 10;
    }

    function validarClabe(clabe) {
        var d = _soloDigitos(clabe);
        if (!d) return { ok: false, motivo: 'vacia', digitos: 0 };
        if (d.length !== 18) return { ok: false, motivo: 'longitud', digitos: d.length };
        if (digitoControl(d) !== parseInt(d.charAt(17), 10)) {
            return { ok: false, motivo: 'control', digitos: 18 };
        }
        return { ok: true, motivo: '', digitos: 18 };
    }

    // Solo para mostrar: banco(3) · plaza(3) · cuenta(11) · control(1)
    function formatearClabe(s) {
        var d = _soloDigitos(s);
        if (d.length !== 18) return d;
        return d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6, 17) + ' ' + d.slice(17);
    }

    window.BancosMX = {
        lista: BANCOS.slice().sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }),
        nombrePorCodigo: nombrePorCodigo,
        bancoDeClabe: bancoDeClabe,
        validarClabe: validarClabe,
        formatearClabe: formatearClabe
    };
})();
