// Copyright 2021 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React, { useEffect, useState, useContext, useRef } from 'react'
import { Space, ComponentsProvider, SpaceVertical, FieldSelectMulti } from '@looker/components'
import { getCore40SDK } from '@looker/extension-sdk-react'
import { getEmbedSDK } from '@looker/embed-sdk';
import { ExtensionContext40 } from '@looker/extension-sdk-react'
import styled from 'styled-components'

const EmbedContainer = styled.div`
  width: 100%;
  height: 90vh;
  & > iframe {
    width: 100%;
    height: 100%;
  }
`;

const CenteredSpan = styled.span`
  width: 100%;
  height: 95vh;
  display: flex;
  justify-content: center;
  align-items: center;
`;

export const VizWithFilter = () => {
  const coreSDK = getCore40SDK();
  const { visualizationData, lookerHostData, visualizationSDK, tileHostData, extensionSDK } = useContext(ExtensionContext40);
  const embedInitialized = useRef(false);
  const configInitialized = useRef(false);
  const [connection, setConnection] = useState(null);
  const [query, setQuery] = useState(null);
  const [filterSelection, setFilterSelection] = useState([]);
  const [hostname, setHostname] = useState(null);

  const { dashboardFilters } = tileHostData;

  // Configuration options
  const vizDefaultConfig = {
    queryId: {
      label: 'Query Id Source',
      type: 'string'
    },
    filterFieldReference: {
      label: 'Filter Field Reference',
      type: 'string'
    }
  };

  // Dashboard Filter Mapping for cascading filters
  // TO DO: make a viz config?
  const dashboardFilterMap = {
    "Product ID":"look_order_items_partitioned.product_id"
  };

  // Filter options for the multi-select
  // TO DO: make a api call based on filter field reference
  const filterOptions = [
    { value: 'Complete', label: 'Complete' },
    { value: 'Processing', label: 'Processing' },
    { value: 'Cancelled', label: 'Cancelled' },
    { value: 'Shipped', label: 'Shipped' },
    { value: 'Returned', label: 'Returned' }
  ];

    // Handle visualization configuration changes
    useEffect(() => {
      if (!hostname) return;
      
      console.log(`Looker VisConfig Effect`);
      const visConfig = visualizationData?.visConfig;
      console.log(`Current visConfig:`, JSON.stringify(visConfig));

      if (!configInitialized.current) {
        console.log("setting default config")
        visualizationSDK.configureVisualization(vizDefaultConfig);
        visualizationSDK.setVisConfig({"queryId":visConfig?.queryId,"filterFieldReference":visConfig?.filterFieldReference});
        configInitialized.current = true
      }

      if (!visConfig || !visConfig?.queryId || !visConfig?.filterFieldReference) {
        console.log('Missing required configuration: queryId or filterFieldReference');
        // setQuery(null);
        return;
      }
  
      const initializeQuery = async () => {
        try {
          console.log(`Attempting to fetch query with ID: ${visConfig.queryId}`);
          const queryInit = await coreSDK.ok(coreSDK.query(visConfig.queryId));
          console.log(`Successfully fetched query:`, queryInit);
          setQuery(queryInit);
        } catch (error) {
          console.error('Error initializing query:', error);
          console.error('Error details:', {
            queryId: visConfig.queryId,
            errorType: error.type,
            errorMessage: error.message
          });
          setQuery(null);
        }
      };
  
      initializeQuery();
    }, [visualizationData?.visConfig]);


    // rendering done when connection is set to support PDF downloads
    useEffect(() => {
      if (visualizationData) {
        extensionSDK.rendered()
      }
    }, [connection])

  // Initialize Embed SDK with hostname
  useEffect(() => {
    console.log(`lookerHostData effect`);
    if (lookerHostData?.hostUrl) {
      try {
        const url = new URL(lookerHostData.hostUrl);
        const extractedHostname = url.hostname;
        console.log(`Initializing Embed SDK with host: ${extractedHostname}`);
        getEmbedSDK().init(extractedHostname);
        setHostname(extractedHostname);
      } catch (error) {
        console.error("Error parsing hostUrl or initializing Embed SDK:", error);
      }
    }
  }, [lookerHostData]);

  // Handle filter selection changes
  useEffect(() => {
    console.log(`Looker Filter Effect`);
    const updateQueryWithFilters = async () => {
      if (!query?.id || !visualizationData?.visConfig?.filterFieldReference) return;
      try {
        const queryInit = await coreSDK.ok(coreSDK.query(query.id));

        const queryBody = {}

        const allowedKeys = [
          "model", "view", "fields", "pivots", "fill_fields", "filters",
          "filter_expression", "sorts", "limit", "column_limit", "total",
          "row_total", "subtotals", "vis_config", "filter_config",
          "visible_ui_sections", "dynamic_fields", "query_timezone"
        ];

        for (const key of allowedKeys) {
          if (Object.prototype.hasOwnProperty.call(queryInit, key)) {
            queryBody[key] = queryInit[key];
          }
        }  

        // Start with existing filters from queryInit
        const existingFilters = queryInit.filters || {};
        const combinedFilters = { ...existingFilters };

        // Add/update filter selection
        if (filterSelection && filterSelection.length > 0) {
          const filterValues = filterSelection.join(',');
          console.log(`Applying filter values: ${filterValues}`);
          combinedFilters[visualizationData?.visConfig?.filterFieldReference] = filterValues;
        } else {
          delete combinedFilters[visualizationData?.visConfig?.filterFieldReference]
        }

        // Add/update dashboard filters
        if (dashboardFilterMap && Object.keys(dashboardFilterMap).length > 0 && dashboardFilters) {
          console.log(`Applying dashboard filters: ${JSON.stringify(dashboardFilters)}`);
          for (const [key, value] of Object.entries(dashboardFilters)) {
            const mappedKey = dashboardFilterMap[key];
            if (mappedKey && value !== null) {
              console.log(`Mapping dashboard filter "${key}" to "${mappedKey}" with value "${value}"`);
              combinedFilters[mappedKey] = value;
            }
          }
        }

        console.log(`combined filters: ${JSON.stringify(combinedFilters)}`)
  
        queryBody.filters = combinedFilters; 

        const newQuery = await coreSDK.ok(coreSDK.create_query(queryBody));
        setQuery(newQuery);

        if (connection) {
          connection.loadQueryVisualization(newQuery.id);
        }
      } catch (error) {
        console.error('Error updating query with filters:', error);
      }
    };

    updateQueryWithFilters();
  }, [filterSelection, visualizationData?.visConfig?.filterFieldReference, dashboardFilters]);

  // Handle embedding the visualization
  useEffect(() => {
    console.log(`Looker Query Effect`);
    if (!hostname || !query?.id) return;

    const pagePropertiesChangedHandler = (height, elementId) => {
      console.log(`page properties changed`);
      if (height && height > 100) {
        const element = document.querySelector(
          `#${elementId} iframe`
        )
        const filterElement = document.getElementById(`#field-filter`)

        const fieldSelectMultiHeight = filterElement.offsetHeight;
        console.log(`filterElement Height: ${fieldSelectMultiHeight}`)
        console.log(`Height frame: ${fieldSelectMultiHeight}`)
        const newIframeHeight = Math.max(0, height - fieldSelectMultiHeight);
        if (element) {
          element.style.height = `${newIframeHeight}px`
        }
      }
    }

    const embedVisualization = async (queryId) => {
      try {
        embedInitialized.current = true;
        // Clear previous embeds
        const embedContainer = document.getElementById("looker-embed");
        if (embedContainer) {
          embedContainer.innerHTML = "";
        }
        const embed = getEmbedSDK().createQueryVisualizationWithId(queryId)
          .appendTo("#looker-embed")
          .withFrameBorder('0')
          .withDynamicIFrameHeight()
          .build()
          .connect()
          .then((conn) => {
            setConnection(conn);
          })
          .catch((error) => {
            console.error('Error connecting to visualization:', error);
            embedInitialized.current = false;
          });
      } catch (error) {
        console.error('Error embedding visualization:', error);
        embedInitialized.current = false;
      }
    };

    if (connection) {
      connection.loadQueryVisualization(query.id)
    } else {
      embedVisualization(query.id)
    }
  }, [query]);

  const visConfig = visualizationData?.visConfig;
  const hasRequiredConfig = visConfig?.queryId && visConfig?.filterFieldReference;
   
  // TO DO: make the filter type dynamic
  return (
    <ComponentsProvider>
      <SpaceVertical gap="none">
        <Space>
          {visConfig?.filterFieldReference ? (
            <FieldSelectMulti
              options={filterOptions}
              onChange={setFilterSelection}
              autoResize={true}
              id="field-filter"
            />
          ) : (
            <CenteredSpan>
              Please configure a Query ID and Filter Field Reference in the visualization settings
            </CenteredSpan>
          )}
        </Space>
          <EmbedContainer id="looker-embed"></EmbedContainer>
      </SpaceVertical>
    </ComponentsProvider>
  );
};
