
exports.parseGBF = function parseGBF(gbf) {

    gbf = gbf.split('\n');

    for(var origin = 0; origin < gbf.length; ++ origin)
        if(gbf[origin].indexOf('ORIGIN ') === 0)
            break;

    var record = {

        /* Collapse everything after the origin (the sequence) into a single
         * string, removing line numbers and spaces.
         */
        sequence: gbf.slice(origin + 1).map(function(line) {

            return line.trim().split(' ').slice(1).join('');

        }).join('')

    };

    /* Parse everything before the ORIGIN (the annotations) with parseFlatFile
     */
    parseFlatFile(gbf.slice(0, origin)).forEach(function(field) {

        switch(field.name)
        {
        case 'LOCUS':

            /* LOCUS       SCU49845                5028 bp    DNA     PLN 23-MAR-2010 */
            var locus = field.value[0].match(/([A-Z\d]+) +(\d+) bp +([A-Z]+) +([A-Z]+) +(\d\d-[A-Z]{3}-\d{4})/);

            if(locus !== null) {

                record.locusName = locus[1];
                record.sequenceLength = locus[2];
                record.moleculeType = locus[3];
                record.division = locus[4];
                record.modified = locus[5];
            }

            /* LOCUS       SCU49845                5028 bp    DNA     linear   PLN 23-MAR-2010 */
            locus = field.value[0].match(/([A-Z\d]+) +(\d+) bp +([A-Z]+) +([a-z]+) +([A-Z]+) +(\d\d-[A-Z]{3}-\d{4})/);

            if(locus !== null) {

                record.locusName = locus[1];
                record.sequenceLength = locus[2];
                record.moleculeType = locus[3];
                record.moleculeTypeDisp = locus[4];
                record.division = locus[5];
                record.modified = locus[6];
            }
            

            break;

        case 'DEFINITION':

            record.definition = field.value.join(' ');
            break;

        case 'ACCESSION':

            record.accession = field.value.join(' ');
            break;

        case 'VERSION':

            record.version = field.value.join(' ');
            break;

        case 'KEYWORDS':

            if(field.value == '.')
                break;

            /* TODO */

            break;

        case 'SOURCE':

            record.source = {
                name: field.value.join(' ')
            };

            field.children.forEach(function(subfield) {

                if(subfield.name == 'ORGANISM') {

                    record.source.organism = {

                        name: subfield.value[0],

                        lineage: subfield.value.slice(1).join(' ').split('; ').map(function(s) {

                            s = s.trim();

                            return s[s.length - 1] == '.' ? s.slice(0, s.length - 1) : s;
                        })
                    };
                }
            });

            break;

        case 'REFERENCE':

            if(record.references === undefined)
                record.references = [];

            var bases = field.value[0].match(/^([0-9]+) +\(bases ([0-9]+) to ([0-9]+)\)$/);

            var reference = bases !== null ? {

                number: parseInt(bases[1]),
                start: parseInt(bases[2]),
                end: parseInt(bases[3])

            } : {};

            field.children.forEach(function(subfield) {
                switch(subfield.name)
                {
                case 'AUTHORS':
                    reference.authors = subfield.value.join(' ');
                    break;

                case 'TITLE':
                    reference.title = subfield.value.join(' ');
                    break;

                case 'JOURNAL':
                    reference.journal = subfield.value.join(' ');
                    break;

                case 'PUBMED':
                    reference.pubmed = subfield.value.join(' ');
                    break;
                };
            });

            record.references.push(reference);

            break;

       case 'FEATURES':

            record.features = [];

            field.children.forEach(function(feature) {

                var location = ''

                for(var i = 0; i < feature.value.length; ++ i) {

                    if(feature.value[i][0] === '/')
                        break

                    location += feature.value[i]
                }

                var f = {
                    key: feature.name,
                    location: parseLocation(location)
                };

                var qualifier;

                /* TODO look for/process specific qualifiers?
                 */
                for(; i < feature.value.length; ++ i) {

                    var qualifierLine = feature.value[i];

                    if(qualifierLine[0] === '/') {

                        qualifier = qualifierLine.split('=')[0];
 
                        var value = qualifierLine.split('"')[1];

                        if(!f[qualifier])
                            f[qualifier] = [ value ]
                        else
                            f[qualifier].push(value)

                    } else {

                        var value = qualifierLine.split('"')[0];

                        if(qualifier !== '/translation')
                            value = ' ' + value

                        f[qualifier][f[qualifier].length - 1] += value
                    }

                }

                record.features.push(f);
            });

            break;
        };
    });

    if(record.references){

        record.references = record.references.sort(function(a, b) {
            return a.number - b.number;
        });
    }
	
    return record;
}


function parseLocation(location) {

    var match = location.match(/([a-z]+)\((.*)\)/)

    if(match !== null) {

        var modifier = match[1]

        if(modifier === 'complement') {

            var innerLocation = parseLocation(match[2])

            innerLocation.strand = 'complementary'

            return innerLocation

        } else if(modifier === 'join') {

            return match[2].split(',').map(parseLocation)

        } else {

            throw new Error('unknown modifier: ' + modifier)

        }

    } else {

        var partial3Prime = location.indexOf('<') !== -1;
        var partial5Prime = location.indexOf('>') !== -1;

        var startEndMatch = location.replace(/[<>]/g, '').match(/^([0-9]+)\.\.([0-9]+)$/);

        if ( startEndMatch == null && location.match(/^([0-9]+)$/) ){
            return {
                start: parseInt(location),
                end: parseInt(location),
                partial3Prime: partial3Prime,
                partial5Prime: partial5Prime
            }
        } else {
            return {
                start: parseInt(startEndMatch[1]),
                end: parseInt(startEndMatch[2]),
                partial3Prime: partial3Prime,
                partial5Prime: partial5Prime
            }
        }
    }
}

function parseFlatFile(lines) {

    function getIndent(line) {

        for(var indent = 0; line[indent] == ' '; )
            ++ indent;

        return indent;
    }

    function readFields(indent) {

        var fields = [],
            field,
            valueColumn;

        while(lines.length > 0) {

            var line = lines[0];

            var lineIndent = getIndent(line);

            if(lineIndent < indent)
                break;

            if(lineIndent > indent) {

                if(lineIndent != valueColumn) {

                    /* children of prev field
                     */
                    field.children = readFields(lineIndent);
                    continue;
                }

                /* continuation
                 */
                field.value.push(line.slice(lineIndent));
            }

            if(lineIndent == indent) {

                /* new field
                 */
                var delim = line.indexOf(' ', lineIndent);

                valueColumn = delim + getIndent(line.slice(delim));

                field = {
                    name: line.slice(lineIndent, delim),
                    value: [ line.slice(valueColumn) ]
                };

                fields.push(field);
            }

            lines = lines.slice(1);
        }

        return fields;
    }

    return readFields(0);
}

